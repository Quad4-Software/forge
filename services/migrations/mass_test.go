// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package migrations

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"forgejo.org/modules/setting"
	"forgejo.org/modules/structs"
	"forgejo.org/modules/test"
	"forgejo.org/services/migrations/allowlist"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// allowLocalNetworks permits the migration HTTP transport to reach the
// loopback httptest servers for the duration of a test.
func allowLocalNetworks(t *testing.T) {
	t.Helper()
	reset := test.MockVariableValueWithReset(&setting.Migrations.AllowLocalNetworks, true, func() {
		require.NoError(t, allowlist.Init())
	})
	t.Cleanup(reset)
}

func writeJSON(t *testing.T, w http.ResponseWriter, v any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	require.NoError(t, json.NewEncoder(w).Encode(v))
}

type ghRepo struct {
	Name        string `json:"name"`
	CloneURL    string `json:"clone_url"`
	HTMLURL     string `json:"html_url"`
	Description string `json:"description"`
	Private     bool   `json:"private"`
	Fork        bool   `json:"fork"`
	Archived    bool   `json:"archived"`
}

func newGitHubMock(t *testing.T, orgRepos, userRepos, selfRepos map[string][]ghRepo, selfLogin string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v3")
		switch {
		case path == "/user":
			if selfLogin == "" {
				http.Error(w, `{"message":"Requires authentication"}`, http.StatusUnauthorized)
				return
			}
			writeJSON(t, w, map[string]any{"login": selfLogin})
		case path == "/user/repos":
			writeJSON(t, w, selfRepos[selfLogin])
		case strings.HasPrefix(path, "/orgs/") && strings.HasSuffix(path, "/repos"):
			owner := strings.TrimSuffix(strings.TrimPrefix(path, "/orgs/"), "/repos")
			repos, ok := orgRepos[owner]
			if !ok {
				http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
				return
			}
			writeJSON(t, w, repos)
		case strings.HasPrefix(path, "/users/") && strings.HasSuffix(path, "/repos"):
			owner := strings.TrimSuffix(strings.TrimPrefix(path, "/users/"), "/repos")
			repos, ok := userRepos[owner]
			if !ok {
				http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
				return
			}
			writeJSON(t, w, repos)
		default:
			http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func TestListRemoteRepositoriesGitHubOrg(t *testing.T) {
	allowLocalNetworks(t)

	server := newGitHubMock(t,
		map[string][]ghRepo{
			"forgejo": {
				{Name: "forgejo", CloneURL: "https://github.com/forgejo/forgejo.git", HTMLURL: "https://github.com/forgejo/forgejo", Description: "the forge"},
				{Name: "forked", CloneURL: "https://github.com/forgejo/forked.git", Fork: true},
				{Name: "old", CloneURL: "https://github.com/forgejo/old.git", Archived: true},
				{Name: "secret", CloneURL: "https://github.com/forgejo/secret.git", Private: true},
			},
		}, nil, nil, "")
	baseURL := server.URL

	repos, err := ListRemoteRepositories(t.Context(), structs.GithubService, baseURL, "forgejo", "", MassListOptions{})
	require.NoError(t, err)
	require.Len(t, repos, 1)
	assert.Equal(t, "forgejo", repos[0].Name)
	assert.Equal(t, "the forge", repos[0].Description)
	assert.Equal(t, "https://github.com/forgejo/forgejo.git", repos[0].CloneURL)

	repos, err = ListRemoteRepositories(t.Context(), structs.GithubService, baseURL, "forgejo", "", MassListOptions{
		IncludeForks:    true,
		IncludeArchived: true,
		IncludePrivate:  true,
	})
	require.NoError(t, err)
	assert.Len(t, repos, 4)
}

func TestListRemoteRepositoriesGitHubUserFallback(t *testing.T) {
	allowLocalNetworks(t)

	server := newGitHubMock(t,
		nil,
		map[string][]ghRepo{
			"someone": {
				{Name: "dotfiles", CloneURL: "https://github.com/someone/dotfiles.git"},
			},
		}, nil, "")

	repos, err := ListRemoteRepositories(t.Context(), structs.GithubService, server.URL, "someone", "", MassListOptions{})
	require.NoError(t, err)
	require.Len(t, repos, 1)
	assert.Equal(t, "dotfiles", repos[0].Name)
}

func TestListRemoteRepositoriesGitHubSelf(t *testing.T) {
	allowLocalNetworks(t)

	server := newGitHubMock(t, nil, nil,
		map[string][]ghRepo{
			"me": {
				{Name: "public", CloneURL: "https://github.com/me/public.git"},
				{Name: "private", CloneURL: "https://github.com/me/private.git", Private: true},
			},
		}, "me")

	repos, err := ListRemoteRepositories(t.Context(), structs.GithubService, server.URL, "me", "token", MassListOptions{
		IncludePrivate: true,
	})
	require.NoError(t, err)
	assert.Len(t, repos, 2)
}

func TestListRemoteRepositoriesGitHubNotFound(t *testing.T) {
	allowLocalNetworks(t)

	server := newGitHubMock(t, nil, nil, nil, "")
	_, err := ListRemoteRepositories(t.Context(), structs.GithubService, server.URL, "nobody", "", MassListOptions{})
	require.Error(t, err)
}

func TestListRemoteRepositoriesGitea(t *testing.T) {
	allowLocalNetworks(t)

	var baseURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		switch path {
		case "/orgs/myorg/repos":
			writeJSON(t, w, []map[string]any{
				{"name": "one", "clone_url": baseURL + "/myorg/one.git", "html_url": baseURL + "/myorg/one", "description": "first"},
				{"name": "two", "clone_url": baseURL + "/myorg/two.git", "fork": true},
			})
		case "/orgs/missing/repos":
			http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
		case "/users/missing/repos":
			writeJSON(t, w, []map[string]any{
				{"name": "userrepo", "clone_url": baseURL + "/missing/userrepo.git"},
			})
		default:
			http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	baseURL = server.URL

	repos, err := ListRemoteRepositories(t.Context(), structs.ForgejoService, baseURL, "myorg", "", MassListOptions{})
	require.NoError(t, err)
	require.Len(t, repos, 1)
	assert.Equal(t, "one", repos[0].Name)
	assert.Equal(t, baseURL+"/myorg/one.git", repos[0].CloneURL)
	assert.Equal(t, "first", repos[0].Description)

	// auto-detection falls back from org listing to user listing
	repos, err = ListRemoteRepositories(t.Context(), structs.GiteaService, baseURL, "missing", "", MassListOptions{})
	require.NoError(t, err)
	require.Len(t, repos, 1)
	assert.Equal(t, "userrepo", repos[0].Name)

	// a missing owner is an error when the type is forced
	_, err = ListRemoteRepositories(t.Context(), structs.GiteaService, baseURL, "missing", "", MassListOptions{OwnerType: MassOwnerOrg})
	require.Error(t, err)
}

func TestListRemoteRepositoriesGiteaSelf(t *testing.T) {
	allowLocalNetworks(t)

	var authed bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		if r.Header.Get("Authorization") == "token sekrit" {
			authed = true
		}
		switch path {
		case "/user":
			if !authed {
				http.Error(w, `{"message":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			writeJSON(t, w, map[string]any{"login": "me", "username": "me"})
		case "/user/repos":
			writeJSON(t, w, []map[string]any{
				{"name": "mine", "clone_url": "http://example.com/me/mine.git"},
				{"name": "secret", "clone_url": "http://example.com/me/secret.git", "private": true},
			})
		default:
			http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	repos, err := ListRemoteRepositories(t.Context(), structs.ForgejoService, server.URL, "me", "sekrit", MassListOptions{
		IncludePrivate: true,
	})
	require.NoError(t, err)
	assert.Len(t, repos, 2)
}

func TestListRemoteRepositoriesEmptyOwner(t *testing.T) {
	_, err := ListRemoteRepositories(t.Context(), structs.GithubService, "https://github.com", "  ", "", MassListOptions{})
	require.Error(t, err)
}

func TestListRemoteRepositoriesUnsupportedService(t *testing.T) {
	_, err := ListRemoteRepositories(t.Context(), structs.GitlabService, "https://gitlab.com", "someone", "", MassListOptions{})
	require.Error(t, err)

	assert.True(t, MassListSupportedService(structs.GithubService))
	assert.True(t, MassListSupportedService(structs.GiteaService))
	assert.True(t, MassListSupportedService(structs.ForgejoService))
	assert.False(t, MassListSupportedService(structs.GitlabService))
	assert.False(t, MassListSupportedService(structs.PlainGitService))
}

func TestListRemoteRepositoriesGiteaMissingBaseURL(t *testing.T) {
	_, err := ListRemoteRepositories(t.Context(), structs.GiteaService, "", "org", "", MassListOptions{})
	require.Error(t, err)

	_, err = ListRemoteRepositories(t.Context(), structs.GithubService, "://bad url", "org", "", MassListOptions{})
	require.Error(t, err)
}

func TestFilterRemoteRepos(t *testing.T) {
	repos := []RemoteRepo{
		{Name: "plain"},
		{Name: "fork", Fork: true},
		{Name: "archived", Archived: true},
		{Name: "private", Private: true},
	}

	filtered := filterRemoteRepos(repos, MassListOptions{})
	require.Len(t, filtered, 1)
	assert.Equal(t, "plain", filtered[0].Name)

	filtered = filterRemoteRepos([]RemoteRepo{
		{Name: "plain"},
		{Name: "fork", Fork: true},
		{Name: "archived", Archived: true},
		{Name: "private", Private: true},
	}, MassListOptions{IncludeForks: true, IncludeArchived: true, IncludePrivate: true})
	assert.Len(t, filtered, 4)
}
