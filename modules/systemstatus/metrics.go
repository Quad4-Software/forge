// Copyright 2026 The Quad4 Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package systemstatus

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HostMetrics holds live host and process resource numbers for the admin dashboard.
type HostMetrics struct {
	Load1   float64
	Load5   float64
	Load15  float64
	HasLoad bool

	CPUPercent float64
	HasCPU     bool
	NumCPU     int

	MemUsed  int64
	MemTotal int64
	HasMem   bool

	ProcessRSS int64
	HasRSS     bool
}

var (
	cpuSampleMu  sync.Mutex
	lastCPUTicks uint64
	lastCPUWall  time.Time
	hasCPUSample bool
)

// Collect gathers load average, process CPU, and memory figures.
// Missing sources are left with Has* false so the UI can hide or show N/A.
func Collect() HostMetrics {
	m := HostMetrics{
		NumCPU: runtime.NumCPU(),
	}
	m.Load1, m.Load5, m.Load15, m.HasLoad = readLoadAvg()
	m.ProcessRSS, m.HasRSS = readProcessRSS()
	m.MemUsed, m.MemTotal, m.HasMem = readMemory()
	m.CPUPercent, m.HasCPU = sampleProcessCPU()
	return m
}

func readLoadAvg() (float64, float64, float64, bool) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, false
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0, false
	}
	l1, err1 := strconv.ParseFloat(fields[0], 64)
	l5, err5 := strconv.ParseFloat(fields[1], 64)
	l15, err15 := strconv.ParseFloat(fields[2], 64)
	if err1 != nil || err5 != nil || err15 != nil {
		return 0, 0, 0, false
	}
	return l1, l5, l15, true
}

func readProcessRSS() (int64, bool) {
	data, err := os.ReadFile("/proc/self/statm")
	if err != nil {
		return 0, false
	}
	fields := strings.Fields(string(data))
	if len(fields) < 2 {
		return 0, false
	}
	pages, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return pages * int64(os.Getpagesize()), true
}

func readMemory() (used, total int64, ok bool) {
	if used, total, ok = readCgroupMemory(); ok {
		return used, total, true
	}
	return readMeminfo()
}

func readCgroupMemory() (used, total int64, ok bool) {
	// cgroup v2
	if current, err := readUintFile("/sys/fs/cgroup/memory.current"); err == nil {
		maxRaw, err := os.ReadFile("/sys/fs/cgroup/memory.max")
		if err != nil {
			return 0, 0, false
		}
		maxStr := strings.TrimSpace(string(maxRaw))
		if maxStr == "max" || maxStr == "" {
			_, hostTotal, hostOK := readMeminfo()
			if !hostOK {
				return 0, 0, false
			}
			return int64(current), hostTotal, true
		}
		max, err := strconv.ParseUint(maxStr, 10, 64)
		if err != nil || max == 0 {
			return 0, 0, false
		}
		return int64(current), int64(max), true
	}

	// cgroup v1
	if current, err := readUintFile("/sys/fs/cgroup/memory/memory.usage_in_bytes"); err == nil {
		limit, err := readUintFile("/sys/fs/cgroup/memory/memory.limit_in_bytes")
		if err != nil || limit == 0 || limit >= 1<<62 {
			_, hostTotal, hostOK := readMeminfo()
			if !hostOK {
				return 0, 0, false
			}
			return int64(current), hostTotal, true
		}
		return int64(current), int64(limit), true
	}
	return 0, 0, false
}

func readMeminfo() (used, total int64, ok bool) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()

	var memTotal, memAvailable int64
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			memTotal = parseMeminfoKB(line) * 1024
		case strings.HasPrefix(line, "MemAvailable:"):
			memAvailable = parseMeminfoKB(line) * 1024
		}
		if memTotal > 0 && memAvailable > 0 {
			break
		}
	}
	if memTotal <= 0 {
		return 0, 0, false
	}
	if memAvailable <= 0 {
		return 0, memTotal, true
	}
	return memTotal - memAvailable, memTotal, true
}

func parseMeminfoKB(line string) int64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	v, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return 0
	}
	return v
}

func readUintFile(path string) (uint64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
}

func sampleProcessCPU() (float64, bool) {
	ticks, ok := readProcessCPUTicks()
	if !ok {
		return 0, false
	}
	now := time.Now()

	cpuSampleMu.Lock()
	defer cpuSampleMu.Unlock()

	if !hasCPUSample {
		lastCPUTicks = ticks
		lastCPUWall = now
		hasCPUSample = true
		return 0, false
	}

	wall := now.Sub(lastCPUWall).Seconds()
	deltaTicks := ticks - lastCPUTicks
	lastCPUTicks = ticks
	lastCPUWall = now
	if wall <= 0 {
		return 0, false
	}

	// Percent of one CPU core. Can exceed 100 with multiple threads.
	hz := float64(clockTicksPerSecond())
	percent := (float64(deltaTicks) / hz) / wall * 100
	if percent < 0 {
		percent = 0
	}
	return percent, true
}

func readProcessCPUTicks() (uint64, bool) {
	data, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, false
	}
	// comm can contain spaces and parentheses so find the last ')' then split the rest.
	s := string(data)
	idx := strings.LastIndex(s, ")")
	if idx < 0 || idx+2 >= len(s) {
		return 0, false
	}
	fields := strings.Fields(s[idx+2:])
	// After comm: state is field 0, utime is field 11, stime is field 12 (1-based fields 14/15 of /proc/pid/stat).
	if len(fields) < 13 {
		return 0, false
	}
	utime, err1 := strconv.ParseUint(fields[11], 10, 64)
	stime, err2 := strconv.ParseUint(fields[12], 10, 64)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	return utime + stime, true
}

func clockTicksPerSecond() int64 {
	// Linux USER_HZ is almost always 100. Avoid cgo sysconf.
	return 100
}

// FormatLoad returns a compact 1/5/15 load string.
func FormatLoad(m HostMetrics) string {
	if !m.HasLoad {
		return "n/a"
	}
	return fmt.Sprintf("%.2f / %.2f / %.2f", m.Load1, m.Load5, m.Load15)
}

// FormatCPU returns a compact process CPU percent string.
func FormatCPU(m HostMetrics) string {
	if !m.HasCPU {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%% (%d cores)", m.CPUPercent, m.NumCPU)
}

// FormatMemPercent returns used/total as a percent string when known.
func FormatMemPercent(m HostMetrics) string {
	if !m.HasMem || m.MemTotal <= 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%%", float64(m.MemUsed)/float64(m.MemTotal)*100)
}
