// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"net/http"
	"sync"

	"forgejo.org/modules/ratelimit"
	"forgejo.org/modules/setting"
)

var (
	expensiveLimiterOnce sync.Once
	expensiveLimiter     *ratelimit.Limiter
)

// RateLimitExpensiveEndpoints rate limits requests to endpoints that are
// expensive to compute, such as compare diffs and blob excerpts. These
// endpoints are a common target of abusive crawlers.
func RateLimitExpensiveEndpoints(next http.Handler) http.Handler {
	expensiveLimiterOnce.Do(func() {
		if setting.IsInTesting {
			// integration tests make bursts of requests from a single client
			return
		}
		expensiveLimiter = ratelimit.New(ratelimit.Spec{
			Rate:                  setting.RateLimit.Rate,
			Burst:                 setting.RateLimit.Burst,
			GlobalRate:            setting.RateLimit.GlobalRate,
			GlobalBurst:           setting.RateLimit.GlobalBurst,
			ExemptPrivateNetworks: setting.RateLimit.ExemptPrivateNetworks,
		})
	})
	return expensiveLimiter.Middleware()(next)
}
