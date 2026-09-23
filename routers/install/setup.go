// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package install

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"forgejo.org/modules/log"
	"forgejo.org/modules/setting"
)

// SetupTokenTTL is how long a generated setup link stays valid.
const SetupTokenTTL = time.Hour

func setupTokenPath() string {
	return filepath.Join(setting.CustomPath, "setup-token")
}

// EnsureSetupToken returns the current valid setup token, generating a new
// one if none exists or the stored one has expired.
func EnsureSetupToken() (token string, expiry time.Time, err error) {
	if token, expiry, ok := loadSetupToken(); ok {
		return token, expiry, nil
	}
	return generateSetupToken()
}

// RegenerateSetupToken always creates a fresh token, replacing any existing one.
func RegenerateSetupToken() (token string, expiry time.Time, err error) {
	return generateSetupToken()
}

func generateSetupToken() (string, time.Time, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", time.Time{}, fmt.Errorf("generate setup token: %w", err)
	}
	token := hex.EncodeToString(raw[:])
	expiry := time.Now().Add(SetupTokenTTL)
	if err := os.MkdirAll(filepath.Dir(setupTokenPath()), 0o755); err != nil {
		return "", time.Time{}, fmt.Errorf("create custom path: %w", err)
	}
	content := token + "\n" + strconv.FormatInt(expiry.Unix(), 10) + "\n"
	if err := os.WriteFile(setupTokenPath(), []byte(content), 0o600); err != nil {
		return "", time.Time{}, fmt.Errorf("write setup token: %w", err)
	}
	return token, expiry, nil
}

func loadSetupToken() (string, time.Time, bool) {
	token, expiry, ok := readSetupToken()
	if !ok || time.Now().After(expiry) {
		return "", time.Time{}, false
	}
	return token, expiry, true
}

// readSetupToken returns the stored token and expiry even when expired.
func readSetupToken() (string, time.Time, bool) {
	data, err := os.ReadFile(setupTokenPath())
	if err != nil {
		return "", time.Time{}, false
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		return "", time.Time{}, false
	}
	unix, err := strconv.ParseInt(strings.TrimSpace(lines[1]), 10, 64)
	if err != nil {
		return "", time.Time{}, false
	}
	return strings.TrimSpace(lines[0]), time.Unix(unix, 0), true
}

// ValidSetupToken reports whether the provided token matches the stored,
// unexpired setup token. The comparison is constant time.
func ValidSetupToken(provided string) bool {
	if provided == "" {
		return false
	}
	token, _, ok := loadSetupToken()
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(token)) == 1
}

// ClearSetupToken removes the setup token after installation completes.
func ClearSetupToken() {
	if err := os.Remove(setupTokenPath()); err != nil && !os.IsNotExist(err) {
		log.Warn("Unable to remove setup token: %v", err)
	}
}

// SetupURL builds the full secure setup link for a token.
func SetupURL(token string) string {
	appURL := strings.TrimSuffix(setting.AppURL, "/")
	return appURL + "/?key=" + token
}

// PrintSetupURL writes the secure setup link to w (stdout), not to the log,
// so the token does not end up persisted in log files.
func PrintSetupURL(w io.Writer) {
	token, expiry, err := EnsureSetupToken()
	if err != nil {
		fmt.Fprintf(w, "Unable to generate secure setup token: %v\n", err)
		return
	}
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "==============================================================")
	fmt.Fprintln(w, "Quad4 Forge is not installed yet.")
	fmt.Fprintf(w, "Secure setup link (expires %s, in %s):\n", expiry.Format(time.RFC3339), time.Until(expiry).Round(time.Minute))
	fmt.Fprintf(w, "  %s\n", SetupURL(token))
	fmt.Fprintln(w, "To regenerate: forge admin regenerate-setup-link")
	fmt.Fprintln(w, "==============================================================")
}
