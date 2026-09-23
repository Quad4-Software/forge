// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package e2e

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"testing"

	"forgejo.org/modules/setting"
)

// TestLighthouse boots a seeded Forgejo instance and runs Lighthouse CI
// against a matrix of pages. Run it explicitly with:
//
//	./e2e.sqlite.test -test.run TestLighthouse
//
// It is not part of the default TestE2e run.
func TestLighthouse(t *testing.T) {
	if os.Getenv("RUN_LIGHTHOUSE") == "" {
		t.Skip("set RUN_LIGHTHOUSE=1 to run Lighthouse CI audits")
	}
	onForgejoRun(t, func(*testing.T, *url.URL) {
		DeclareGitRepos(t)
		cmd := exec.Command("npx", "lhci", "autorun")
		cmd.Env = append(os.Environ(), fmt.Sprintf("GITEA_URL=%s", setting.AppURL))
		cmd.Dir = setting.AppWorkPath
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			t.Fatalf("Lighthouse CI failed: %v", err)
		}
	})
}
