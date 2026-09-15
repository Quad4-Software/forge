// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

// Package ratelimit provides a per-client token bucket rate limiter intended
// for expensive endpoints that are common targets for abusive crawlers.
package ratelimit

import (
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	// how long a client may be idle before its bucket is garbage collected
	visitorTTL = 3 * time.Minute
	// how often the visitor map is swept for stale entries
	sweepInterval = time.Minute
)

// Spec configures a Limiter.
type Spec struct {
	// Rate is the allowed requests per second per client. A non-positive
	// value disables the per-client limit.
	Rate float64
	// Burst is the maximum burst of requests per client before throttling.
	Burst int
	// GlobalRate is the allowed requests per second across all clients, a
	// backstop against distributed floods that evade the per-client limit.
	// A non-positive value disables the global limit.
	GlobalRate float64
	// GlobalBurst is the maximum burst for the global limit.
	GlobalBurst int
	// ExemptPrivateNetworks skips rate limiting for clients on loopback,
	// private (RFC 1918 and ULA), link-local and CGNAT (RFC 6598) addresses,
	// covering localhost, LAN, Docker and VPN clients. RemoteAddr cannot be
	// spoofed over TCP, so this only exempts genuinely local traffic.
	ExemptPrivateNetworks bool
}

// Limiter is a per-client rate limiter backed by token buckets. A nil Limiter
// allows every request.
type Limiter struct {
	limit         rate.Limit
	burst         int
	global        *rate.Limiter
	exemptPrivate bool

	mu        sync.Mutex
	visitors  map[string]*visitor
	lastSweep time.Time
}

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// New returns a rate limiter from the given spec. It returns nil if no limit
// is configured.
func New(spec Spec) *Limiter {
	if spec.Rate <= 0 && spec.GlobalRate <= 0 {
		return nil
	}
	l := &Limiter{exemptPrivate: spec.ExemptPrivateNetworks}
	if spec.Rate > 0 {
		l.limit = rate.Limit(spec.Rate)
		l.burst = max(spec.Burst, 1)
		l.visitors = map[string]*visitor{}
	}
	if spec.GlobalRate > 0 {
		l.global = rate.NewLimiter(rate.Limit(spec.GlobalRate), max(spec.GlobalBurst, 1))
	}
	return l
}

// cgnatRange is the shared address space from RFC 6598, used by Tailscale,
// Kubernetes pod networks and some ISPs.
var cgnatRange = netip.MustParsePrefix("100.64.0.0/10")

// isExempt reports whether the client address is on a network that should
// never be rate limited: loopback, private, link-local, unspecified,
// multicast or CGNAT space.
func isExempt(addr netip.Addr) bool {
	return addr.IsLoopback() ||
		addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() ||
		addr.IsMulticast() ||
		addr.IsUnspecified() ||
		cgnatRange.Contains(addr)
}

// clientKey maps a client address to its rate limit bucket. IPv6 clients are
// bucketed by /64 prefix so that rotating addresses within a subnet, a common
// bot technique, does not evade the limit.
func clientKey(addr netip.Addr) string {
	if addr.Is6() {
		return netip.PrefixFrom(addr, 64).Masked().String()
	}
	return addr.String()
}

// AllowClient reports whether a request from the given client address (an IP
// or host:port) may proceed. Clients that cannot be identified, e.g. local
// transports like unix sockets, are never limited.
func (l *Limiter) AllowClient(addr string) bool {
	if l == nil {
		return true
	}

	parsed, err := netip.ParseAddr(addr)
	if err != nil {
		if host, _, splitErr := net.SplitHostPort(addr); splitErr == nil {
			parsed, err = netip.ParseAddr(host)
		}
	}
	if err != nil {
		// Local transports such as unix sockets cannot be bucketed.
		return true
	}
	parsed = parsed.Unmap()
	if l.exemptPrivate && isExempt(parsed) {
		return true
	}

	if l.global != nil && !l.global.Allow() {
		return false
	}
	return l.allowKey(clientKey(parsed))
}

func (l *Limiter) allowKey(key string) bool {
	if l.visitors == nil {
		return true
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	if now.Sub(l.lastSweep) > sweepInterval {
		for k, v := range l.visitors {
			if now.Sub(v.lastSeen) > visitorTTL {
				delete(l.visitors, k)
			}
		}
		l.lastSweep = now
	}

	v, ok := l.visitors[key]
	if !ok {
		v = &visitor{limiter: rate.NewLimiter(l.limit, l.burst)}
		l.visitors[key] = v
	}
	v.lastSeen = now
	return v.limiter.Allow()
}

// retryAfter returns the number of seconds a rejected client should wait
// before retrying, i.e. the time needed to refill a single token.
func (l *Limiter) retryAfter() int {
	limit := float64(l.limit)
	if l.visitors == nil || (l.global != nil && float64(l.global.Limit()) < limit) {
		limit = float64(l.global.Limit())
	}
	if limit <= 0 {
		return 1
	}
	return int(math.Ceil(1 / limit))
}

// Middleware returns an HTTP middleware that rate limits requests by client
// IP. Requests over the limit receive a 429 response.
func (l *Limiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if l != nil && !l.AllowClient(req.RemoteAddr) {
				w.Header().Set("Retry-After", strconv.Itoa(l.retryAfter()))
				http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, req)
		})
	}
}
