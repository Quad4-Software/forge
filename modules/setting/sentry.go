// Copyright 2026 The Quad4 Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package setting

import (
	"strings"
	"strconv"
	"time"

	"forgejo.org/modules/log"

	"github.com/getsentry/sentry-go"
)

// Sentry settings (GlitchTip-compatible DSN).
var Sentry = struct {
	Enabled             bool
	DSN                 string
	FrontendDSN         string
	Environment         string
	TracesSampleRate    float64
	SendDefaultPII      bool
	Debug               bool
}{}

func loadSentryFrom(rootCfg ConfigProvider) {
	sec := rootCfg.Section("sentry")
	Sentry.Enabled = sec.Key("ENABLED").MustBool(false)
	Sentry.DSN = strings.TrimSpace(sec.Key("DSN").MustString(""))
	Sentry.FrontendDSN = strings.TrimSpace(sec.Key("FRONTEND_DSN").MustString(""))
	Sentry.Environment = sec.Key("ENVIRONMENT").MustString(RunMode)
	if v := strings.TrimSpace(sec.Key("TRACES_SAMPLE_RATE").String()); v != "" {
		if rate, err := strconv.ParseFloat(v, 64); err == nil {
			Sentry.TracesSampleRate = rate
		} else {
			log.Error("Invalid sentry.TRACES_SAMPLE_RATE %q: %v", v, err)
		}
	}
	Sentry.SendDefaultPII = sec.Key("SEND_DEFAULT_PII").MustBool(false)
	Sentry.Debug = sec.Key("DEBUG").MustBool(false)

	if !Sentry.Enabled {
		return
	}
	if Sentry.DSN == "" && Sentry.FrontendDSN == "" {
		log.Warn("sentry ENABLED but no DSN/FRONTEND_DSN set")
		Sentry.Enabled = false
		return
	}
	if Sentry.DSN == "" {
		return
	}

	err := sentry.Init(sentry.ClientOptions{
		Dsn:              Sentry.DSN,
		Environment:      Sentry.Environment,
		TracesSampleRate: Sentry.TracesSampleRate,
		SendDefaultPII:   Sentry.SendDefaultPII,
		Debug:            Sentry.Debug,
		Release:          AppVer,
	})
	if err != nil {
		log.Error("sentry.Init failed: %v", err)
		Sentry.Enabled = false
		return
	}
	log.Info("Sentry/GlitchTip error reporting enabled (environment=%s)", Sentry.Environment)
}

// CaptureException sends an error to Sentry/GlitchTip when enabled.
func CaptureException(err error) {
	if err == nil || !Sentry.Enabled || Sentry.DSN == "" {
		return
	}
	sentry.CaptureException(err)
}

// CapturePanic reports a recovered panic value.
func CapturePanic(recovered any) {
	if recovered == nil || !Sentry.Enabled || Sentry.DSN == "" {
		return
	}
	hub := sentry.CurrentHub()
	hub.Recover(recovered)
	sentry.Flush(2 * time.Second)
}

// FrontendDSNOrEmpty returns browser DSN (FRONTEND_DSN or DSN).
func FrontendDSNOrEmpty() string {
	if !Sentry.Enabled {
		return ""
	}
	if Sentry.FrontendDSN != "" {
		return Sentry.FrontendDSN
	}
	return Sentry.DSN
}
