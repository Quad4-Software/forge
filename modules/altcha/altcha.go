// Copyright 2026 The Quad4 Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package altcha

import (
	"net/http"
	"strings"
	"time"

	"forgejo.org/modules/json"
	"forgejo.org/modules/log"
	"forgejo.org/modules/setting"

	altchalib "github.com/altcha-org/altcha-lib-go"
)

// CreateChallengeJSON writes a fresh ALTCHA challenge for the widget.
func CreateChallengeJSON(w http.ResponseWriter, r *http.Request) {
	if !setting.Service.EnableCaptcha || setting.Service.CaptchaType != setting.Altcha {
		http.Error(w, "altcha disabled", http.StatusNotFound)
		return
	}
	if setting.Service.AltchaMode == setting.AltchaModeRemote {
		http.Error(w, "remote altcha mode", http.StatusNotFound)
		return
	}
	key := strings.TrimSpace(setting.Service.AltchaHMACKey)
	if key == "" {
		log.Error("ALTCHA_HMAC_KEY is empty")
		http.Error(w, "misconfigured", http.StatusInternalServerError)
		return
	}

	maxNumber := setting.Service.AltchaMaxNumber
	if maxNumber <= 0 {
		maxNumber = altchalib.DefaultMaxNumber
	}
	expires := time.Now().UTC().Add(setting.Service.AltchaExpires)
	challenge, err := altchalib.CreateChallenge(altchalib.ChallengeOptions{
		HMACKey:   key,
		MaxNumber: maxNumber,
		Expires:   &expires,
	})
	if err != nil {
		log.Error("altcha CreateChallenge: %v", err)
		http.Error(w, "challenge failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(challenge); err != nil {
		log.Error("altcha encode challenge: %v", err)
	}
}

// Verify checks an ALTCHA form payload.
// Mode "solution" uses VerifySolution (self-hosted / embedded PoW).
// Mode "server_signature" uses VerifyServerSignature (Sentinel / Cloud spam filter).
func Verify(payload string) (bool, error) {
	payload = strings.TrimSpace(payload)
	if payload == "" {
		return false, nil
	}
	key := strings.TrimSpace(setting.Service.AltchaHMACKey)
	if key == "" {
		return false, nil
	}

	switch setting.Service.AltchaVerifyMode {
	case setting.AltchaVerifyServerSignature:
		ok, _, err := altchalib.VerifyServerSignature(payload, key)
		return ok, err
	default:
		return altchalib.VerifySolution(payload, key, true)
	}
}
