// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package setting

import (
	"forgejo.org/modules/log"
)

// RateLimit is the global rate limiter configuration for expensive endpoints
// such as compare diffs and blob excerpts, which are common targets for
// abusive crawlers.
var RateLimit = struct {
	// Rate is the number of allowed requests per second per client. IPv6
	// clients are bucketed by /64 prefix. A non-positive value disables the
	// per-client limit.
	Rate float64
	// Burst is the maximum number of requests a client may make in a short
	// burst before being throttled.
	Burst int
	// GlobalRate is the number of allowed requests per second across all
	// clients, a backstop against distributed floods. A non-positive value
	// disables the global limit.
	GlobalRate float64
	// GlobalBurst is the maximum burst across all clients.
	GlobalBurst int
	// ExemptPrivateNetworks skips rate limiting for clients on loopback,
	// private, link-local and CGNAT addresses.
	ExemptPrivateNetworks bool
}{
	Rate:                  1,
	Burst:                 8,
	GlobalRate:            25,
	GlobalBurst:           50,
	ExemptPrivateNetworks: true,
}

func loadRateLimitFrom(rootCfg ConfigProvider) {
	sec := rootCfg.Section("rate_limit")
	if err := sec.MapTo(&RateLimit); err != nil {
		log.Fatal("Failed to map rate limit settings: %v", err)
	}
}
