// Copyright 2023 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package install

import (
	"net/http/httptest"
	"testing"

	"forgejo.org/models/unittest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRoutes(t *testing.T) {
	r := Routes()
	assert.NotNil(t, r)

	token, _, err := EnsureSetupToken()
	require.NoError(t, err)
	defer ClearSetupToken()

	// no setup key: gated with 403
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 403, w.Code)

	// wrong setup key: gated with 403
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/?key=deadbeef", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 403, w.Code)

	// valid setup key: install form
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/?key="+token, nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 200, w.Code)
	assert.Contains(t, w.Body.String(), `class="page-content install"`)
	assert.Contains(t, w.Body.String(), `name="setup_key"`)

	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/no-such", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 404, w.Code)

	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/assets/img/forgejo.svg", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, 200, w.Code)
}

func TestMain(m *testing.M) {
	unittest.MainTest(m, &unittest.TestOptions{IniFileOverride: "install.ini"})
}
