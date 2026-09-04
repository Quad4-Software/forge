// Copyright 2026 The Quad4 Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package systemstatus

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCollectLinuxBasics(t *testing.T) {
	m := Collect()
	assert.Positive(t, m.NumCPU)
	if m.HasLoad {
		assert.GreaterOrEqual(t, m.Load1, 0.0)
		assert.GreaterOrEqual(t, m.Load5, 0.0)
		assert.GreaterOrEqual(t, m.Load15, 0.0)
		assert.NotEqual(t, "n/a", FormatLoad(m))
	}
	if m.HasRSS {
		assert.Positive(t, m.ProcessRSS)
	}
	if m.HasMem {
		assert.Positive(t, m.MemTotal)
		assert.GreaterOrEqual(t, m.MemUsed, int64(0))
		assert.NotEqual(t, "n/a", FormatMemPercent(m))
	}

	// Second sample can produce a CPU reading after the baseline.
	_ = Collect()
	m2 := Collect()
	if m2.HasCPU {
		assert.GreaterOrEqual(t, m2.CPUPercent, 0.0)
		assert.NotEqual(t, "n/a", FormatCPU(m2))
	}
}

func TestConnectionCounters(t *testing.T) {
	beforeHTTP := ActiveHTTP()
	beforeSSH := ActiveSSH()

	IncHTTP()
	IncSSH()
	assert.Equal(t, beforeHTTP+1, ActiveHTTP())
	assert.Equal(t, beforeSSH+1, ActiveSSH())

	DecHTTP()
	DecSSH()
	assert.Equal(t, beforeHTTP, ActiveHTTP())
	assert.Equal(t, beforeSSH, ActiveSSH())
}
