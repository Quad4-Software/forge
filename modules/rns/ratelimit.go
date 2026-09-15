// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package rns

import (
	"sync"
	"time"
)

// rnsRateLimiter applies a simple token bucket per Reticulum identity hash so a
// single peer cannot amplify work through repeated bundle fetch or push
// requests. Anonymous peers share a single bucket keyed by an empty string.
type rnsRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rnsBucket
	limit   int
	period  time.Duration
}

type rnsBucket struct {
	used   int
	window time.Time
}

var gitOpLimiter = newRNSRateLimiter(12, time.Minute)

func newRNSRateLimiter(limit int, period time.Duration) *rnsRateLimiter {
	return &rnsRateLimiter{entries: map[string]*rnsBucket{}, limit: limit, period: period}
}

// allow reports whether one expensive operation is permitted for key.
func (l *rnsRateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b, ok := l.entries[key]
	if !ok || now.Sub(b.window) >= l.period {
		b = &rnsBucket{window: now}
		l.entries[key] = b
	}
	if b.used >= l.limit {
		return false
	}
	b.used++
	return true
}

// rateLimitKey returns the bucket key for a peer identity.
func rateLimitKey(hexHash string) string {
	if hexHash == "" {
		return "anonymous"
	}
	return hexHash
}
