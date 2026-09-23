// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package migrations

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"forgejo.org/modules/structs"
	"forgejo.org/services/migrations/allowlist"

	"code.gitea.io/sdk/gitea"
	"github.com/google/go-github/v81/github"
	"golang.org/x/oauth2"
)

// MassOwnerType selects how the remote owner is resolved when listing
// repositories for a mass migration.
type MassOwnerType string

const (
	// MassOwnerAuto tries organization listing first and falls back to user listing
	MassOwnerAuto MassOwnerType = "auto"
	// MassOwnerOrg lists organization repositories
	MassOwnerOrg MassOwnerType = "org"
	// MassOwnerUser lists user repositories
	MassOwnerUser MassOwnerType = "user"
)

// RemoteRepo is a repository discovered on a remote service that can be
// selected for mass migration or mirroring.
type RemoteRepo struct {
	Name        string
	CloneURL    string
	HTMLURL     string
	Description string
	Private     bool
	Fork        bool
	Archived    bool
}

// MassListOptions filters the remote repositories returned by a listing
type MassListOptions struct {
	OwnerType       MassOwnerType
	IncludeForks    bool
	IncludeArchived bool
	IncludePrivate  bool
}

// MassListSupportedService returns whether repositories can be listed for the
// given service type.
func MassListSupportedService(service structs.GitServiceType) bool {
	switch service {
	case structs.GithubService, structs.GiteaService, structs.ForgejoService:
		return true
	}
	return false
}

// ListRemoteRepositories lists the repositories owned by owner (a user or an
// organization) on the given service. baseURL is the web URL of the service,
// e.g. "https://github.com" or a Forgejo/Gitea/GitHub Enterprise instance URL.
func ListRemoteRepositories(ctx context.Context, service structs.GitServiceType, baseURL, owner, token string, opts MassListOptions) ([]RemoteRepo, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, errors.New("owner must not be empty")
	}
	if opts.OwnerType == "" {
		opts.OwnerType = MassOwnerAuto
	}

	switch service {
	case structs.GithubService:
		return listGitHubRepos(ctx, baseURL, owner, token, opts)
	case structs.GiteaService, structs.ForgejoService:
		return listGiteaRepos(ctx, baseURL, owner, token, opts)
	}
	return nil, fmt.Errorf("mass migration listing is not supported for service %q", service.Name())
}

func filterRemoteRepos(repos []RemoteRepo, opts MassListOptions) []RemoteRepo {
	filtered := repos[:0]
	for _, r := range repos {
		if r.Fork && !opts.IncludeForks {
			continue
		}
		if r.Archived && !opts.IncludeArchived {
			continue
		}
		if r.Private && !opts.IncludePrivate {
			continue
		}
		filtered = append(filtered, r)
	}
	return filtered
}

func massHTTPClient(token string) *http.Client {
	if token != "" {
		return &http.Client{
			Transport: &oauth2.Transport{
				Base:   allowlist.NewMigrationHTTPTransport(),
				Source: oauth2.ReuseTokenSource(nil, oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})),
			},
		}
	}
	return allowlist.NewMigrationHTTPClient()
}

func isGitHubNotFound(err error) bool {
	var errResp *github.ErrorResponse
	return errors.As(err, &errResp) && errResp.Response != nil && errResp.Response.StatusCode == http.StatusNotFound
}

func listGitHubRepos(ctx context.Context, baseURL, owner, token string, opts MassListOptions) ([]RemoteRepo, error) {
	if baseURL == "" {
		baseURL = "https://github.com"
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("invalid base URL %q", baseURL)
	}
	baseURL = u.Scheme + "://" + u.Host

	client := github.NewClient(massHTTPClient(token))
	if baseURL != "https://github.com" {
		client, err = client.WithEnterpriseURLs(baseURL, baseURL)
		if err != nil {
			return nil, err
		}
	}

	listOpts := github.ListOptions{PerPage: 100}
	var ghRepos []*github.Repository

	if token != "" {
		// if the owner is the authenticated user, list through the authenticated
		// endpoint so private repositories are included
		if self, _, err := client.Users.Get(ctx, ""); err == nil && strings.EqualFold(self.GetLogin(), owner) {
			for {
				page, resp, err := client.Repositories.ListByAuthenticatedUser(ctx, &github.RepositoryListByAuthenticatedUserOptions{
					Visibility:  "all",
					ListOptions: listOpts,
				})
				if err != nil {
					return nil, err
				}
				ghRepos = append(ghRepos, page...)
				if resp.NextPage == 0 {
					break
				}
				listOpts.Page = resp.NextPage
			}
			return filterRemoteRepos(githubToRemote(ghRepos), opts), nil
		}
	}

	if opts.OwnerType != MassOwnerUser {
		for {
			page, resp, err := client.Repositories.ListByOrg(ctx, owner, &github.RepositoryListByOrgOptions{
				Type:        "all",
				ListOptions: listOpts,
			})
			if err != nil {
				if opts.OwnerType == MassOwnerAuto && isGitHubNotFound(err) {
					break
				}
				return nil, err
			}
			ghRepos = append(ghRepos, page...)
			if resp.NextPage == 0 {
				return filterRemoteRepos(githubToRemote(ghRepos), opts), nil
			}
			listOpts.Page = resp.NextPage
		}
	}

	// owner is a user, or auto-detection found no organization with this name
	listOpts.Page = 1
	ghRepos = nil
	for {
		page, resp, err := client.Repositories.ListByUser(ctx, owner, &github.RepositoryListByUserOptions{
			Type:        "all",
			ListOptions: listOpts,
		})
		if err != nil {
			return nil, err
		}
		ghRepos = append(ghRepos, page...)
		if resp.NextPage == 0 {
			break
		}
		listOpts.Page = resp.NextPage
	}
	return filterRemoteRepos(githubToRemote(ghRepos), opts), nil
}

func githubToRemote(ghRepos []*github.Repository) []RemoteRepo {
	repos := make([]RemoteRepo, 0, len(ghRepos))
	for _, r := range ghRepos {
		repos = append(repos, RemoteRepo{
			Name:        r.GetName(),
			CloneURL:    r.GetCloneURL(),
			HTMLURL:     r.GetHTMLURL(),
			Description: r.GetDescription(),
			Private:     r.GetPrivate(),
			Fork:        r.GetFork(),
			Archived:    r.GetArchived(),
		})
	}
	return repos
}

func listGiteaRepos(ctx context.Context, baseURL, owner, token string, opts MassListOptions) ([]RemoteRepo, error) {
	if baseURL == "" {
		return nil, errors.New("an instance URL is required for Gitea and Forgejo mass migration")
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("invalid base URL %q", baseURL)
	}

	clientOpts := []gitea.ClientOption{
		gitea.SetHTTPClient(massHTTPClient("")),
		gitea.SetContext(ctx),
		// listing repositories exists on every remotely recent version, skip the version probe
		gitea.SetGiteaVersion("1.20.0"),
	}
	if token != "" {
		clientOpts = append(clientOpts, gitea.SetToken(token))
	}
	client, err := gitea.NewClient(u.Scheme+"://"+u.Host, clientOpts...)
	if err != nil {
		return nil, err
	}

	listPage := func(page int) ([]*gitea.Repository, *gitea.Response, error) {
		listOpts := gitea.ListOptions{Page: page, PageSize: 50}
		return client.ListOrgRepos(owner, gitea.ListOrgReposOptions{ListOptions: listOpts})
	}

	if token != "" {
		// if the owner is the authenticated user, list through the authenticated
		// endpoint so private repositories are included
		if self, _, err := client.GetMyUserInfo(); err == nil && strings.EqualFold(self.UserName, owner) {
			listPage = func(page int) ([]*gitea.Repository, *gitea.Response, error) {
				listOpts := gitea.ListOptions{Page: page, PageSize: 50}
				return client.ListMyRepos(gitea.ListReposOptions{ListOptions: listOpts})
			}
		}
	}

	var giteaRepos []*gitea.Repository
	if opts.OwnerType != MassOwnerUser {
		for page := 1; ; {
			repos, resp, err := listPage(page)
			if err != nil {
				if opts.OwnerType == MassOwnerAuto {
					break
				}
				return nil, err
			}
			giteaRepos = append(giteaRepos, repos...)
			if resp == nil || resp.NextPage == 0 {
				return filterRemoteRepos(giteaToRemote(giteaRepos), opts), nil
			}
			page = resp.NextPage
		}
	}

	// owner is a user, or auto-detection found no organization with this name
	for page := 1; ; {
		repos, resp, err := client.ListUserRepos(owner, gitea.ListReposOptions{
			Page: page, PageSize: 50,
		})
		if err != nil {
			return nil, err
		}
		giteaRepos = append(giteaRepos, repos...)
		if resp == nil || resp.NextPage == 0 {
			break
		}
		page = resp.NextPage
	}
	return filterRemoteRepos(giteaToRemote(giteaRepos), opts), nil
}

func giteaToRemote(giteaRepos []*gitea.Repository) []RemoteRepo {
	repos := make([]RemoteRepo, 0, len(giteaRepos))
	for _, r := range giteaRepos {
		repos = append(repos, RemoteRepo{
			Name:        r.Name,
			CloneURL:    r.CloneURL,
			HTMLURL:     r.HTMLURL,
			Description: r.Description,
			Private:     r.Private,
			Fork:        r.Fork,
			Archived:    r.Archived,
		})
	}
	return repos
}
