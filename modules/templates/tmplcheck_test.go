// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package templates

import (
	"testing"

	"forgejo.org/modules/setting"
)

// TestCompileAllTemplates verifies every shipped template parses.
func TestCompileAllTemplates(t *testing.T) {
	setting.IsProd = true
	r := HTMLRenderer()
	if err := r.CompileTemplates(); err != nil {
		t.Fatal(err)
	}
}
