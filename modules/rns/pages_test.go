// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package rns

import (
	"testing"

	"github.com/Quad4-Software/Reticulum-Go/pkg/rnsgit"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPageVars(t *testing.T) {
	data, err := rnsgit.EncodeMixedRequest(map[any]any{
		"var_g":   "owner",
		"var_r":   "repo",
		"var_ref": "main",
		"other":   "ignored",
	})
	require.NoError(t, err)
	vars := pageVars(data)
	assert.Equal(t, "owner", vars["g"])
	assert.Equal(t, "repo", vars["r"])
	assert.Equal(t, "main", vars["ref"])
	assert.NotContains(t, vars, "other")
}

func TestPageVarsBadData(t *testing.T) {
	assert.Empty(t, pageVars(nil))
	assert.Empty(t, pageVars([]byte("not-msgpack")))
}

func TestMLink(t *testing.T) {
	got := mLink("repo", "/page/repo.mu", map[string]string{"g": "o", "r": "r"})
	assert.Equal(t, "`[repo`:/page/repo.mu`g=o|r=r]", got)
	assert.Equal(t, "`[x`:/page/index.mu]", mLink("x", "/page/index.mu", nil))
	// Markup chars are stripped from labels.
	assert.Equal(t, "`[ab`:/p]", mLink("a`[b]", "/p", nil))
}

func TestMEscape(t *testing.T) {
	assert.Equal(t, "a\\`b", mEscape("a`b"))
	assert.Equal(t, "a\\\\b", mEscape("a\\b"))
}
