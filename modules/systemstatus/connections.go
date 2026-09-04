// Copyright 2026 The Quad4 Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package systemstatus

import "sync/atomic"

var (
	activeHTTP atomic.Int64
	activeSSH  atomic.Int64
)

// ActiveHTTP returns the number of open HTTP connections to this process.
func ActiveHTTP() int64 {
	return activeHTTP.Load()
}

// ActiveSSH returns the number of open built-in SSH connections to this process.
func ActiveSSH() int64 {
	return activeSSH.Load()
}

// IncHTTP records a new HTTP connection.
func IncHTTP() {
	activeHTTP.Add(1)
}

// DecHTTP records a closed HTTP connection.
func DecHTTP() {
	activeHTTP.Add(-1)
}

// IncSSH records a new built-in SSH connection.
func IncSSH() {
	activeSSH.Add(1)
}

// DecSSH records a closed built-in SSH connection.
func DecSSH() {
	activeSSH.Add(-1)
}
