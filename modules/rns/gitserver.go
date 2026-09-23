// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package rns

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	perm_model "forgejo.org/models/perm"
	access_model "forgejo.org/models/perm/access"
	repo_model "forgejo.org/models/repo"
	unit_model "forgejo.org/models/unit"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/setting"

	"github.com/Quad4-Software/Reticulum-Go/pkg/destination"
	"github.com/Quad4-Software/Reticulum-Go/pkg/identity"
	"github.com/Quad4-Software/Reticulum-Go/pkg/link"
	"github.com/Quad4-Software/Reticulum-Go/pkg/rnsgit"
	"github.com/Quad4-Software/Reticulum-Go/pkg/transport"
)

// GitServer serves Forgejo repositories over the rngit wire protocol on the
// git.repositories destination. Repository paths map group/repo onto
// owner/repo. Authentication uses the Reticulum identity presented by link
// identify, resolved to a user through registered RNSKey rows.
type GitServer struct {
	dest *destination.Destination
	git  *rnsgit.GitRunner
	tr   *transport.Transport
	id   *identity.Identity
}

// NewGitServer creates the destination and registers the rngit request
// handlers for list, fetch, push and delete.
func NewGitServer(tr *transport.Transport, id *identity.Identity) (*GitServer, error) {
	dest, err := destination.New(id, destination.In, destination.Single, rnsgit.AppName, tr, rnsgit.Aspect)
	if err != nil {
		return nil, err
	}
	s := &GitServer{dest: dest, git: rnsgit.NewGitRunner(), tr: tr, id: id}
	for _, h := range []struct {
		path string
		fn   destination.ResponseGeneratorFunc
	}{
		{rnsgit.PathList, s.handleList},
		{rnsgit.PathFetch, s.handleFetch},
		{rnsgit.PathPush, s.handlePush},
		{rnsgit.PathDelete, s.handleDelete},
		{rnsgit.PathCreate, s.handleUnsupported},
		{rnsgit.PathFork, s.handleUnsupported},
		{rnsgit.PathSync, s.handleUnsupported},
		{rnsgit.PathMirror, s.handleUnsupported},
		{rnsgit.PathPerms, s.handleUnsupported},
		{rnsgit.PathRelease, s.handleUnsupported},
		{rnsgit.PathWork, s.handleUnsupported},
	} {
		if err := dest.RegisterRequestHandlerAny(h.path, h.fn, destination.AllowAll, nil); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// DestinationHash returns the hex encoded git.repositories destination hash.
func (s *GitServer) DestinationHash() string {
	return hex.EncodeToString(s.dest.GetHash())
}

// Announce announces the repositories destination.
func (s *GitServer) Announce() {
	_ = s.dest.Announce(false, nil, nil)
}

func (s *GitServer) handleUnsupported(path string, data, _, _ []byte, _ *identity.Identity, _ int64) any {
	return rnsgit.StatusResponse(rnsgit.ResDisallowed, "Operation is not supported by this node, use the Forgejo web interface")
}

// resolvedRepo carries the repo resolution and authentication result shared by
// the request handlers.
type resolvedRepo struct {
	repo     *repo_model.Repository
	owner    *user_model.User
	pusher   *user_model.User
	rnsKey   *user_model.RNSKey
	isWiki   bool
	unitType unit_model.Type
	gitDir   string
}

// resolveRepo maps an rngit group/repo path to a Forgejo repository and
// checks that the remote identity is allowed wantMode access. A nil remote is
// the anonymous peer and only allowed read access to public repositories when
// rns.ANONYMOUS_READ is enabled.
func resolveRepo(ctx context.Context, remote *identity.Identity, repoPath string, wantMode perm_model.AccessMode) (*resolvedRepo, error) {
	ownerName, repoName, ok := rnsgit.ParseRepoPath(repoPath)
	if !ok {
		return nil, fmt.Errorf("invalid repository path")
	}

	rr := &resolvedRepo{unitType: unit_model.TypeCode}
	if strings.HasSuffix(repoName, ".wiki") {
		rr.isWiki = true
		rr.unitType = unit_model.TypeWiki
		repoName = strings.TrimSuffix(repoName, ".wiki")
	}

	owner, err := user_model.GetUserByName(ctx, ownerName)
	if err != nil {
		return nil, err
	}
	repo, err := repo_model.GetRepositoryByName(ctx, owner.ID, repoName)
	if err != nil {
		return nil, err
	}
	if repo.IsBeingCreated() || repo.IsBroken() {
		return nil, fmt.Errorf("repository is not ready")
	}
	rr.repo = repo
	rr.owner = owner
	if rr.isWiki {
		rr.gitDir = repo.WikiPath()
	} else {
		rr.gitDir = repo.RepoPath()
	}

	if remote != nil {
		key, err := user_model.GetRNSKeyByIdentityHash(ctx, hex.EncodeToString(remote.Hash()))
		if err != nil {
			if !user_model.IsErrRNSKeyNotExist(err) {
				return nil, err
			}
		} else if key.Verified {
			rr.rnsKey = key
			pusher, err := user_model.GetUserByID(ctx, key.OwnerID)
			if err != nil {
				return nil, err
			}
			if !pusher.IsActive || pusher.ProhibitLogin {
				return nil, fmt.Errorf("account is not active")
			}
			rr.pusher = pusher
		}
	}

	// A permission check is required for writes, for non-public repositories,
	// when sign-in is required for viewing, and for restricted users.
	mustCheck := wantMode > perm_model.AccessModeRead ||
		repo.IsPrivate || owner.Visibility.IsPrivate() ||
		setting.Service.RequireSignInView ||
		(rr.pusher != nil && rr.pusher.IsRestricted)
	if mustCheck {
		if !keyVerified(rr) {
			return nil, errNotFound
		}
		perm, err := access_model.GetUserRepoPermission(ctx, repo, rr.pusher)
		if err != nil {
			return nil, err
		}
		if perm.UnitAccessMode(rr.unitType) < wantMode {
			return nil, errNotFound
		}
	} else if !setting.RNS.AnonymousRead && rr.pusher == nil {
		return nil, errNotFound
	}

	if wantMode > perm_model.AccessModeRead && rr.rnsKey != nil {
		_ = user_model.UpdateRNSKeyActivity(ctx, rr.rnsKey)
	}

	return rr, nil
}

var errNotFound = fmt.Errorf("not found")

func keyVerified(rr *resolvedRepo) bool {
	return rr.rnsKey != nil && rr.rnsKey.Verified
}

// canRead reports whether the resolved pusher or anonymous peer may read.
func canRead(ctx context.Context, rr *resolvedRepo) bool {
	if rr.pusher != nil && keyVerified(rr) {
		perm, err := access_model.GetUserRepoPermission(ctx, rr.repo, rr.pusher)
		if err == nil && perm.UnitAccessMode(rr.unitType) >= perm_model.AccessModeRead {
			return true
		}
	}
	return setting.RNS.AnonymousRead && !rr.repo.IsPrivate && !rr.owner.Visibility.IsPrivate() && !setting.Service.RequireSignInView
}

// deny produces the rngit denial response: NotFound for peers without read
// access, Disallowed for peers who can read but lack the requested mode.
func deny(ctx context.Context, rr *resolvedRepo) []byte {
	if rr != nil && canRead(ctx, rr) {
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, "Not allowed")
	}
	return rnsgit.StatusResponse(rnsgit.ResNotFound, "Not found")
}

func repoFromRequest(data []byte) (map[any]any, string, error) {
	req, err := rnsgit.DecodeRequest(data)
	if err != nil {
		return nil, "", err
	}
	repoPath, ok := rnsgit.RepoFromRequest(req)
	if !ok {
		return nil, "", fmt.Errorf("no repository specified")
	}
	return req, repoPath, nil
}

func (s *GitServer) handleList(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	req, repoPath, err := repoFromRequest(data)
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
	}
	wantMode := perm_model.AccessModeRead
	if forPush, ok := req["for_push"].(bool); ok && forPush {
		wantMode = perm_model.AccessModeWrite
	}
	ctx := context.Background()
	rr, err := resolveRepo(ctx, remote, repoPath, wantMode)
	if err != nil {
		return deny(ctx, rr)
	}
	body, err := s.git.ListRefs(rr.gitDir)
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Could not list refs")
	}
	return append([]byte{rnsgit.ResOK}, []byte(body)...)
}

func (s *GitServer) handleFetch(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	req, repoPath, err := repoFromRequest(data)
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
	}
	key := ""
	if remote != nil {
		key = hex.EncodeToString(remote.Hash())
	}
	if !gitOpLimiter.allow(rateLimitKey(key)) {
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, "Rate limited")
	}
	ctx := context.Background()
	rr, err := resolveRepo(ctx, remote, repoPath, perm_model.AccessModeRead)
	if err != nil {
		return deny(ctx, rr)
	}

	refsList, ok := req["refs"].([]any)
	if !ok {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "No refs specified")
	}
	refs := make([]map[string]string, 0, len(refsList))
	names := make([]string, 0, len(refsList))
	for _, item := range refsList {
		m, ok := normalizeMap(item)
		if !ok {
			return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
		}
		ref := fmt.Sprint(m["ref"])
		if rnsgit.SanRef(ref) == "" {
			return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
		}
		entry := map[string]string{"ref": ref}
		if hv, ok := m["have"]; ok {
			entry["have"] = fmt.Sprint(hv)
		}
		refs = append(refs, entry)
		names = append(names, ref)
	}
	if rnsgit.SanRefs(names) == nil {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
	}
	var have []string
	if hv, ok := req["have"].([]any); ok {
		for _, x := range hv {
			if h := rnsgit.SanSHA(fmt.Sprint(x)); h != "" {
				have = append(have, h)
			}
		}
	}

	tmp, err := os.MkdirTemp("", "forgejo-rns-fetch-")
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Remote error")
	}
	defer os.RemoveAll(tmp)
	bundlePath := filepath.Join(tmp, "fetch.bundle")
	if err := s.git.CreateBundle(rr.gitDir, bundlePath, refs, have); err != nil {
		if rnsgit.IsEmptyBundle(err) {
			return []byte{rnsgit.ResOK}
		}
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Could not fetch refs")
	}
	bundle, err := os.ReadFile(bundlePath)
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Remote error")
	}
	return link.FileResponse{Data: bundle, MetadataPacked: rnsgit.OKMetadataPacked(), AutoCompress: true}
}

func normalizeMap(item any) (map[any]any, bool) {
	if m, ok := item.(map[any]any); ok {
		return m, true
	}
	if m2, ok := item.(map[string]any); ok {
		m := map[any]any{}
		for k, v := range m2 {
			m[k] = v
		}
		return m, true
	}
	return nil, false
}
