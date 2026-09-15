// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"forgejo.org/modules/setting"
	"forgejo.org/modules/web"

	"github.com/stretchr/testify/assert"
)

// TestRateLimitExpensiveEndpoints exercises the middleware through the real
// route machinery, covering limiting, the private network exemption and
// X-Forwarded-For spoofing resistance.
func TestRateLimitExpensiveEndpoints(t *testing.T) {
	oldTesting := setting.IsInTesting
	oldRateLimit := setting.RateLimit
	defer func() {
		setting.IsInTesting = oldTesting
		setting.RateLimit = oldRateLimit
	}()
	setting.IsInTesting = false
	setting.RateLimit.Rate = 1000
	setting.RateLimit.Burst = 2
	setting.RateLimit.GlobalRate = 0
	setting.RateLimit.GlobalBurst = 0
	setting.RateLimit.ExemptPrivateNetworks = true

	m := web.NewRoute()
	calls := 0
	m.Get("/compare", RateLimitExpensiveEndpoints, func(resp http.ResponseWriter, _ *http.Request) {
		calls++
		resp.WriteHeader(http.StatusNoContent)
	})

	serve := func(remoteAddr, xff string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/compare", nil)
		req.RemoteAddr = remoteAddr
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		resp := httptest.NewRecorder()
		m.ServeHTTP(resp, req)
		return resp
	}

	// the burst of 2 is allowed, the third request is throttled
	assert.Equal(t, http.StatusNoContent, serve("9.9.9.9:1", "").Code)
	assert.Equal(t, http.StatusNoContent, serve("9.9.9.9:2", "").Code)
	assert.Equal(t, http.StatusTooManyRequests, serve("9.9.9.9:3", "").Code)

	// spoofed X-Forwarded-For does not evade the limit
	assert.Equal(t, http.StatusTooManyRequests, serve("9.9.9.9:4", "1.1.1.1").Code)

	// LAN and Docker clients are never limited
	for range 10 {
		assert.Equal(t, http.StatusNoContent, serve("172.17.0.2:1234", "").Code)
		assert.Equal(t, http.StatusNoContent, serve("192.168.1.5:1234", "").Code)
	}
	// 2 allowed by the burst, 20 exempt private-network requests; the two
	// throttled requests never reached the handler
	assert.Equal(t, 22, calls)
}
