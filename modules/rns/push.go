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
	"forgejo.org/modules/git"
	"forgejo.org/modules/log"
	"forgejo.org/modules/private"

	"github.com/Quad4-Software/Reticulum-Go/pkg/identity"
	"github.com/Quad4-Software/Reticulum-Go/pkg/rnsgit"
)

// maxBundleSize caps the accepted push bundle at 256 MiB.
const maxBundleSize = 256 << 20

// refUpdate is one pending ref change from a push or delete request.
type refUpdate struct {
	oldSHA string
	newSHA string
	ref    string
	force  bool
}

func (s *GitServer) handlePush(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
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
	rr, err := resolveRepo(ctx, remote, repoPath, perm_model.AccessModeWrite)
	if err != nil {
		return deny(ctx, rr)
	}
	if rr.repo.IsMirror {
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, "Mirror repositories are read-only")
	}
	if rr.repo.IsArchived {
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, "Repository is archived")
	}

	if bundle, ok := req["bundle"]; ok {
		return s.pushBundle(ctx, rr, req, bundle)
	}
	if ops, ok := req["operations"]; ok {
		return s.pushOperations(ctx, rr, req, ops)
	}
	return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request data")
}

// pushBundle handles a push that carries a git bundle. The bundle is verified,
// its objects are fetched into the repository, and the ref update then goes
// through the standard Forgejo hook pipeline.
func (s *GitServer) pushBundle(ctx context.Context, rr *resolvedRepo, req map[any]any, bundle any) any {
	localRef := rnsgit.SanRef(fmt.Sprint(req["local_ref"]))
	remoteRef := rnsgit.SanRef(fmt.Sprint(req["remote_ref"]))
	force, _ := req["force"].(bool)
	if localRef == "" || remoteRef == "" {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Missing ref specification")
	}

	var bundleData []byte
	switch b := bundle.(type) {
	case []byte:
		bundleData = b
	case string:
		bundleData = []byte(b)
	default:
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid bundle")
	}
	if len(bundleData) > maxBundleSize {
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, "Bundle exceeds size limit")
	}

	tmp, err := os.MkdirTemp("", "forgejo-rns-push-")
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Remote error")
	}
	defer os.RemoveAll(tmp)
	bundlePath := filepath.Join(tmp, "push.bundle")
	if err := os.WriteFile(bundlePath, bundleData, 0o600); err != nil {
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Remote error")
	}
	if err := s.git.VerifyBundle(rr.gitDir, bundlePath); err != nil {
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Could not verify bundle")
	}

	// Resolve the new commit from the bundle head listing before importing.
	newSHA, err := s.bundleHeadSHA(ctx, rr.gitDir, bundlePath, localRef)
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Could not read bundle head")
	}

	// Import objects without touching any ref. FETCH_HEAD is left as
	// bookkeeping, concurrent fetches only ever overwrite it with the latest
	// fetched commit.
	if _, stderr, err := git.NewCommand(ctx, "fetch", "--no-tags").
		AddDynamicArguments(bundlePath, localRef).
		RunStdString(&git.RunOpts{Dir: rr.gitDir}); err != nil {
		log.Error("rns push fetch failed in %s: %s", rr.gitDir, stderr)
		return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Could not import bundle objects")
	}

	update := refUpdate{ref: remoteRef, newSHA: newSHA, force: force}
	return s.applyRefUpdates(ctx, rr, []refUpdate{update}, req)
}

// pushOperations handles a no-op push: every object already exists in the
// repository, so the request only carries ref updates.
func (s *GitServer) pushOperations(ctx context.Context, rr *resolvedRepo, req map[any]any, ops any) any {
	list, ok := ops.([]any)
	if !ok {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid data for operations")
	}
	updates := make([]refUpdate, 0, len(list))
	for _, item := range list {
		m, ok := normalizeMap(item)
		if !ok {
			return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
		}
		if fmt.Sprint(m["action"]) != "update_ref" {
			return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Unknown operation")
		}
		ref := rnsgit.SanRef(fmt.Sprint(m["ref"]))
		sha := rnsgit.SanSHA(fmt.Sprint(m["sha"]))
		force, _ := m["force"].(bool)
		if ref == "" || sha == "" || !strings.HasPrefix(ref, "refs/") {
			return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
		}
		if !s.git.ObjectExists(rr.gitDir, sha) {
			return rnsgit.StatusResponse(rnsgit.ResRemoteFail, "Object does not exist in repository")
		}
		updates = append(updates, refUpdate{ref: ref, newSHA: sha, force: force})
	}
	return s.applyRefUpdates(ctx, rr, updates, req)
}

func (s *GitServer) handleDelete(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	req, repoPath, err := repoFromRequest(data)
	if err != nil {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
	}
	ctx := context.Background()
	rr, err := resolveRepo(ctx, remote, repoPath, perm_model.AccessModeWrite)
	if err != nil {
		return deny(ctx, rr)
	}
	if rr.repo.IsMirror || rr.repo.IsArchived {
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, "Repository is read-only")
	}
	ref := rnsgit.SanRef(fmt.Sprint(req["ref"]))
	if ref == "" || !strings.HasPrefix(ref, "refs/") {
		return rnsgit.StatusResponse(rnsgit.ResInvalidReq, "Invalid request")
	}
	return s.applyRefUpdates(ctx, rr, []refUpdate{{ref: ref}}, req)
}

// emptySHA returns the zero object ID for the repository object format.
func (s *GitServer) emptySHA(rr *resolvedRepo) string {
	return git.ObjectFormatFromName(rr.repo.ObjectFormatName).EmptyObjectID().String()
}

// bundleHeadSHA resolves the sha of a ref advertised by a bundle.
func (s *GitServer) bundleHeadSHA(ctx context.Context, repoDir, bundlePath, ref string) (string, error) {
	stdout, _, err := git.NewCommand(ctx, "bundle", "list-heads").
		AddDynamicArguments(bundlePath).
		RunStdString(&git.RunOpts{Dir: repoDir})
	if err != nil {
		return "", err
	}
	for line := range strings.Lines(stdout) {
		fields := strings.Fields(line)
		if len(fields) == 2 && (fields[1] == ref || fields[1] == "refs/heads/"+ref || fields[1] == "refs/tags/"+ref) {
			if sha := rnsgit.SanSHA(fields[0]); sha != "" {
				return sha, nil
			}
		}
	}
	return "", fmt.Errorf("ref %s not found in bundle", ref)
}

// refSHA resolves the current value of a ref, or the empty object ID when the
// ref does not exist.
func (s *GitServer) refSHA(ctx context.Context, rr *resolvedRepo, ref string) string {
	empty := s.emptySHA(rr)
	stdout, _, err := git.NewCommand(ctx, "rev-parse", "--verify", "--quiet").
		AddDynamicArguments(ref).
		RunStdString(&git.RunOpts{Dir: rr.gitDir})
	if err != nil {
		return empty
	}
	if sha := rnsgit.SanSHA(strings.TrimSpace(stdout)); sha != "" {
		return sha
	}
	return empty
}

// isFastForward reports whether oldSHA is an ancestor of newSHA.
func (s *GitServer) isFastForward(ctx context.Context, rr *resolvedRepo, oldSHA, newSHA string) bool {
	_, _, err := git.NewCommand(ctx, "merge-base", "--is-ancestor").
		AddDynamicArguments(oldSHA, newSHA).
		RunStdString(&git.RunOpts{Dir: rr.gitDir})
	return err == nil
}

// applyRefUpdates runs the Forgejo hook pipeline for a batch of ref updates:
// pre-receive validates every ref, proc-receive handles AGit pull request
// refs, surviving refs are applied with a compare-and-swap update-ref, and
// post-receive runs for everything that landed.
func (s *GitServer) applyRefUpdates(ctx context.Context, rr *resolvedRepo, updates []refUpdate, req map[any]any) any {
	empty := s.emptySHA(rr)
	for i := range updates {
		if updates[i].oldSHA == "" {
			updates[i].oldSHA = s.refSHA(ctx, rr, updates[i].ref)
		}
		if updates[i].newSHA == "" {
			updates[i].newSHA = empty
		}
	}

	opts := private.HookOptions{
		UserID:         rr.pusher.ID,
		UserName:       rr.pusher.Name,
		IsWiki:         rr.isWiki,
		GitPushOptions: pushOptionsFromRequest(req),
	}
	for _, u := range updates {
		opts.OldCommitIDs = append(opts.OldCommitIDs, u.oldSHA)
		opts.NewCommitIDs = append(opts.NewCommitIDs, u.newSHA)
		opts.RefFullNames = append(opts.RefFullNames, git.RefName(u.ref))
	}

	extra := private.HookPreReceive(ctx, rr.owner.Name, rr.repo.Name, opts)
	if extra.HasError() {
		msg := extra.UserMsg
		if msg == "" {
			msg = "pre-receive hook declined the push"
		}
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, msg)
	}

	// Partition AGit managed refs from plain ref updates. proc-receive applies
	// pull request refs itself and reports the actual ref written.
	var agitIdx, normalIdx []int
	for i, u := range updates {
		refName := git.RefName(u.ref)
		if refName.IsFor() || refName.IsPull() {
			agitIdx = append(agitIdx, i)
		} else {
			normalIdx = append(normalIdx, i)
		}
	}

	var applied []refUpdate
	var firstErr string

	if len(agitIdx) > 0 {
		subOpts := private.HookOptions{
			UserID:         rr.pusher.ID,
			UserName:       rr.pusher.Name,
			IsWiki:         rr.isWiki,
			GitPushOptions: opts.GitPushOptions,
		}
		for _, i := range agitIdx {
			subOpts.OldCommitIDs = append(subOpts.OldCommitIDs, updates[i].oldSHA)
			subOpts.NewCommitIDs = append(subOpts.NewCommitIDs, updates[i].newSHA)
			subOpts.RefFullNames = append(subOpts.RefFullNames, git.RefName(updates[i].ref))
		}
		result, extra := private.HookProcReceive(ctx, rr.owner.Name, rr.repo.Name, subOpts)
		if extra.HasError() || result == nil {
			msg := extra.UserMsg
			if msg == "" {
				msg = "proc-receive hook failed"
			}
			return rnsgit.StatusResponse(rnsgit.ResDisallowed, msg)
		}
		for _, res := range result.Results {
			if res.Err != "" {
				if firstErr == "" {
					firstErr = res.Err
				}
				continue
			}
			applied = append(applied, refUpdate{oldSHA: res.OldOID, newSHA: res.NewOID, ref: res.Ref})
		}
	}

	for _, i := range normalIdx {
		u := updates[i]
		if u.newSHA == empty {
			if _, stderr, err := git.NewCommand(ctx, "update-ref", "-d").
				AddDynamicArguments(u.ref).
				RunStdString(&git.RunOpts{Dir: rr.gitDir}); err != nil {
				if firstErr == "" {
					firstErr = "could not delete ref: " + strings.TrimSpace(stderr)
				}
				continue
			}
			applied = append(applied, u)
			continue
		}
		if u.oldSHA != empty && !u.force && !s.isFastForward(ctx, rr, u.oldSHA, u.newSHA) {
			if firstErr == "" {
				firstErr = "non-fast-forward update, force required"
			}
			continue
		}
		// Compare-and-swap on the old value so a concurrent update can not be
		// overwritten silently.
		if _, stderr, err := git.NewCommand(ctx, "update-ref").
			AddDynamicArguments(u.ref, u.newSHA, u.oldSHA).
			RunStdString(&git.RunOpts{Dir: rr.gitDir}); err != nil {
			if firstErr == "" {
				firstErr = "could not update ref: " + strings.TrimSpace(stderr)
			}
			continue
		}
		applied = append(applied, u)
	}

	if len(applied) > 0 {
		postOpts := private.HookOptions{
			UserID:   rr.pusher.ID,
			UserName: rr.pusher.Name,
			IsWiki:   rr.isWiki,
		}
		for _, u := range applied {
			postOpts.OldCommitIDs = append(postOpts.OldCommitIDs, u.oldSHA)
			postOpts.NewCommitIDs = append(postOpts.NewCommitIDs, u.newSHA)
			postOpts.RefFullNames = append(postOpts.RefFullNames, git.RefName(u.ref))
		}
		if _, extra := private.HookPostReceive(ctx, rr.owner.Name, rr.repo.Name, postOpts); extra.HasError() {
			log.Error("rns post-receive failed for %s/%s: %s", rr.owner.Name, rr.repo.Name, extra.Error)
		}
	}

	if firstErr != "" && len(applied) == 0 {
		return rnsgit.StatusResponse(rnsgit.ResDisallowed, firstErr)
	}
	return []byte{rnsgit.ResOK}
}

// pushOptionsFromRequest extracts an optional push_options string map from the
// request, used to carry AGit topic, title and force options.
func pushOptionsFromRequest(req map[any]any) map[string]string {
	if req == nil {
		return nil
	}
	raw, ok := req["push_options"]
	if !ok {
		return nil
	}
	m, ok := normalizeMap(raw)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[fmt.Sprint(k)] = fmt.Sprint(v)
	}
	return out
}
