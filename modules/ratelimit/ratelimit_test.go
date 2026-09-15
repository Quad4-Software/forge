// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package ratelimit

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLimiterAllow(t *testing.T) {
	limiter := New(Spec{Rate: 1, Burst: 3})

	// burst of 3 is allowed
	for range 3 {
		assert.True(t, limiter.AllowClient("1.2.3.4"))
	}
	// next request exceeds the burst
	assert.False(t, limiter.AllowClient("1.2.3.4"))
	// a different client has its own bucket
	assert.True(t, limiter.AllowClient("5.6.7.8"))
}

func TestLimiterPortInsensitive(t *testing.T) {
	limiter := New(Spec{Rate: 1, Burst: 1})

	assert.True(t, limiter.AllowClient("1.2.3.4:1111"))
	// the same client from a different port shares the bucket
	assert.False(t, limiter.AllowClient("1.2.3.4:2222"))
	assert.True(t, limiter.AllowClient("5.6.7.8:1111"))
}

func TestLimiterIPv6Subnet(t *testing.T) {
	limiter := New(Spec{Rate: 1, Burst: 2})

	// rotating source addresses within a /64 shares one bucket
	assert.True(t, limiter.AllowClient("2001:db8:abcd:1234::1"))
	assert.True(t, limiter.AllowClient("2001:db8:abcd:1234:ffff:ffff:ffff:ffff"))
	assert.False(t, limiter.AllowClient("2001:db8:abcd:1234::beef"))
	// a different /64 has its own bucket
	assert.True(t, limiter.AllowClient("2001:db8:abcd:5678::1"))
}

func TestLimiterIPv4MappedIPv6(t *testing.T) {
	limiter := New(Spec{Rate: 1, Burst: 1})

	assert.True(t, limiter.AllowClient("1.2.3.4"))
	// an IPv4-mapped IPv6 form of the same address shares the bucket
	assert.False(t, limiter.AllowClient("::ffff:1.2.3.4"))
}

func TestLimiterPrivateNetworksExempt(t *testing.T) {
	limiter := New(Spec{Rate: 0.001, Burst: 1, ExemptPrivateNetworks: true})

	exempt := []string{
		"127.0.0.1",
		"::1",
		"10.0.0.5",
		"172.17.0.2",   // docker bridge
		"172.31.255.1", // rest of 172.16/12
		"192.168.1.10",
		"169.254.1.1", // ipv4 link-local
		"fe80::1",     // ipv6 link-local
		"fd00::42",    // ULA
		"100.64.7.9",  // CGNAT (tailscale, k8s pod cidrs)
		"0.0.0.0",
	}
	for _, addr := range exempt {
		for range 50 {
			assert.True(t, limiter.AllowClient(addr), "addr %s should be exempt", addr)
		}
	}
	// public addresses are still limited
	assert.True(t, limiter.AllowClient("203.0.113.9"))
	assert.False(t, limiter.AllowClient("203.0.113.9"))
}

func TestLimiterPrivateNetworksDisabled(t *testing.T) {
	limiter := New(Spec{Rate: 1, Burst: 1, ExemptPrivateNetworks: false})

	assert.True(t, limiter.AllowClient("10.0.0.5"))
	assert.False(t, limiter.AllowClient("10.0.0.5"))
}

func TestLimiterUnidentifiableClientExempt(t *testing.T) {
	limiter := New(Spec{Rate: 0.001, Burst: 1})

	// unix sockets and other local transports cannot be bucketed
	for range 50 {
		assert.True(t, limiter.AllowClient("@"))
		assert.True(t, limiter.AllowClient(""))
	}
}

func TestLimiterGlobalBackstop(t *testing.T) {
	limiter := New(Spec{Rate: 100, Burst: 100, GlobalRate: 1, GlobalBurst: 3})

	// a flood from many distinct IPs is capped by the global limit
	allowed := 0
	for i := range 20 {
		if limiter.AllowClient(fmt.Sprintf("8.8.%d.1", i)) {
			allowed++
		}
	}
	assert.Equal(t, 3, allowed)
}

func TestLimiterGlobalOnly(t *testing.T) {
	limiter := New(Spec{GlobalRate: 1, GlobalBurst: 2})
	assert.NotNil(t, limiter)

	assert.True(t, limiter.AllowClient("8.8.8.1"))
	assert.True(t, limiter.AllowClient("8.8.8.2"))
	assert.False(t, limiter.AllowClient("8.8.8.3"))
}

func TestLimiterDisabled(t *testing.T) {
	assert.Nil(t, New(Spec{}))

	var disabled *Limiter
	for range 100 {
		assert.True(t, disabled.AllowClient("1.2.3.4"))
	}
}

func TestLimiterMiddleware(t *testing.T) {
	limiter := New(Spec{Rate: 1, Burst: 1})
	handler := limiter.Middleware()

	next := &countingHandler{}
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "9.9.9.9:1234"

	resp := httptest.NewRecorder()
	handler(next).ServeHTTP(resp, req)
	assert.Equal(t, 200, resp.Code)
	assert.Equal(t, 1, next.calls)

	// a spoofed X-Forwarded-For does not evade the limit; only RemoteAddr counts
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "9.9.9.9:5678"
	req.Header.Set("X-Forwarded-For", "1.1.1.1")
	resp = httptest.NewRecorder()
	handler(next).ServeHTTP(resp, req)
	assert.Equal(t, 429, resp.Code)
	assert.Equal(t, "1", resp.Header().Get("Retry-After"))
	assert.Equal(t, 1, next.calls)
}

type countingHandler struct{ calls int }

func (h *countingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.calls++
}
