// Copyright 2023, 2024, 2025 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package forgefed_test

import (
	"testing"

	"forgejo.org/modules/forgefed"
	"forgejo.org/modules/setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewRepositoryId(t *testing.T) {
	var sut, expected forgefed.RepositoryID
	var err error
	setting.AppURL = "http://localhost:3000/"

	_, err = forgefed.NewRepositoryID("https://an.other.host/api/v1/activitypub/user-id/1", "forgejo")
	require.EqualError(t, err, "Validation Error: forgefed.RepositoryID: path: \"api/v1/activitypub/user-id\" has to be a repo specific api path")

	expected = forgefed.RepositoryID{
		ID:                 "1",
		Source:             "forgejo",
		HostSchema:         "http",
		Path:               "api/activitypub/repository-id",
		Host:               "localhost",
		HostPort:           3000,
		IsPortSupplemented: false,
		UnvalidatedInput:   "http://localhost:3000/api/activitypub/repository-id/1",
	}
	sut, err = forgefed.NewRepositoryID("http://localhost:3000/api/activitypub/repository-id/1", "forgejo")
	require.NoError(t, err)
	assert.Equal(t, expected, sut)
}
