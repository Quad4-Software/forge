// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package rns

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"forgejo.org/models/db"
	repo_model "forgejo.org/models/repo"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/optional"
	"forgejo.org/modules/setting"

	"github.com/Quad4-Software/Reticulum-Go/pkg/destination"
	"github.com/Quad4-Software/Reticulum-Go/pkg/identity"
	"github.com/Quad4-Software/Reticulum-Go/pkg/rnsgit"
	"github.com/Quad4-Software/Reticulum-Go/pkg/transport"
)

// PageServer serves the nomadnetwork.node destination: a NomadNet compatible
// page surface in Micron markup listing repositories and rendering tree, blob,
// commits and refs pages. Repository access uses the same resolution and
// permission checks as the rngit git destination: anonymous peers see public
// repositories only when rns.ANONYMOUS_READ is enabled, identified peers see
// what their verified RNS key owner may read.
type PageServer struct {
	dest *destination.Destination
	git  *rnsgit.GitRunner
	name string
}

// Page request paths matching the reference rngit page node, so NomadNet
// clients can browse this node like any other.
const (
	pageIndex   = "/page/index.mu"
	pageGroup   = "/page/group.mu"
	pageRepo    = "/page/repo.mu"
	pageTree    = "/page/tree.mu"
	pageBlob    = "/page/blob.mu"
	pageCommits = "/page/commits.mu"
	pageCommit  = "/page/commit.mu"
	pageRefs    = "/page/refs.mu"
)

const (
	blobLimit       = 256 * 1024
	treePageSize    = 200
	commitsPageSize = 50
	maxListRepos    = 500
)

// NewPageServer creates the nomadnetwork.node destination on the shared node
// transport and registers the page request handlers.
func NewPageServer(tr *transport.Transport, id *identity.Identity) (*PageServer, error) {
	dest, err := destination.New(id, destination.In, destination.Single, "nomadnetwork", tr, "node")
	if err != nil {
		return nil, err
	}
	s := &PageServer{dest: dest, git: rnsgit.NewGitRunner(), name: setting.RNS.NodeName}
	dest.SetDefaultAppData([]byte(s.name))
	routes := []struct {
		path string
		fn   destination.ResponseGeneratorFunc
	}{
		{pageIndex, s.serveIndex},
		{pageGroup, s.serveGroup},
		{pageRepo, s.serveRepo},
		{pageTree, s.serveTree},
		{pageBlob, s.serveBlob},
		{pageCommits, s.serveCommits},
		{pageCommit, s.serveCommit},
		{pageRefs, s.serveRefs},
	}
	for _, r := range routes {
		if err := dest.RegisterRequestHandlerAny(r.path, wrapPage(r.fn), destination.AllowAll, nil); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// DestinationHash returns the hex encoded nomadnetwork.node destination hash.
func (s *PageServer) DestinationHash() string {
	return hex.EncodeToString(s.dest.GetHash())
}

// Announce announces the page destination.
func (s *PageServer) Announce() {
	_ = s.dest.Announce(false, nil, nil)
}

// wrapPage recovers panics in page handlers so a rendering bug cannot take
// down the request dispatcher.
func wrapPage(fn destination.ResponseGeneratorFunc) destination.ResponseGeneratorFunc {
	return func(path string, data, reqID, linkID []byte, remote *identity.Identity, at int64) (out any) {
		defer func() {
			if r := recover(); r != nil {
				out = []byte("! Internal error while rendering page\n")
			}
		}()
		return fn(path, data, reqID, linkID, remote, at)
	}
}

// pageVars extracts the var_* fields a NomadNet client sends for links that
// carry field parameters.
func pageVars(data []byte) map[string]string {
	vars := map[string]string{}
	req, err := rnsgit.DecodeRequest(data)
	if err != nil {
		return vars
	}
	for k, v := range req {
		ks, ok := k.(string)
		if !ok {
			if kb, ok2 := k.([]byte); ok2 {
				ks = string(kb)
				ok = true
			}
		}
		if !ok || !strings.HasPrefix(ks, "var_") {
			continue
		}
		vars[strings.TrimPrefix(ks, "var_")] = fmt.Sprint(v)
	}
	return vars
}

// Micron markup helpers matching the reference page node output.

func mEscape(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	return strings.ReplaceAll(s, "`", "\\`")
}

func mLink(label, path string, fields map[string]string) string {
	var b strings.Builder
	b.WriteString("`[")
	b.WriteString(strings.NewReplacer("[", "", "]", "", "`", "").Replace(label))
	b.WriteString("`:")
	b.WriteString(path)
	if len(fields) > 0 {
		keys := make([]string, 0, len(fields))
		for k := range fields {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteString("`")
		for i, k := range keys {
			if i > 0 {
				b.WriteString("|")
			}
			b.WriteString(k + "=" + url.QueryEscape(fields[k]))
		}
	}
	b.WriteString("]")
	return b.String()
}

func mPageError(msg string) []byte {
	return []byte("> Error\n\n" + mEscape(msg) + "\n")
}

// repoVars builds the standard g/r link fields for a repository.
func repoVars(owner, repo string) map[string]string {
	return map[string]string{"g": owner, "r": repo}
}

// actorFor resolves the remote Reticulum identity to a Forgejo user through a
// verified RNS key, matching the git destination rules.
func actorFor(ctx context.Context, remote *identity.Identity) *user_model.User {
	if remote == nil {
		return nil
	}
	key, err := user_model.GetRNSKeyByIdentityHash(ctx, hex.EncodeToString(remote.Hash()))
	if err != nil || !key.Verified {
		return nil
	}
	u, err := user_model.GetUserByID(ctx, key.OwnerID)
	if err != nil || !u.IsActive || u.ProhibitLogin {
		return nil
	}
	return u
}

// accessibleRepos returns repositories visible to the remote peer. Anonymous
// peers get public repositories only when anonymous read is enabled.
func (s *PageServer) accessibleRepos(ctx context.Context, remote *identity.Identity, ownerID int64) (repo_model.RepositoryList, error) {
	actor := actorFor(ctx, remote)
	anonymous := actor == nil
	if anonymous && (!setting.RNS.AnonymousRead || setting.Service.RequireSignInView) {
		return nil, nil
	}
	opts := &repo_model.SearchRepoOptions{
		ListOptions: db.ListOptions{Page: 0, PageSize: maxListRepos},
		Actor:       actor,
		OwnerID:     ownerID,
		AllPublic:   true,
		AllLimited:  true,
	}
	if anonymous {
		opts.IsPrivate = optional.Some(false)
	} else {
		opts.Private = true
	}
	repos, _, err := repo_model.SearchRepository(ctx, opts)
	return repos, err
}

func (s *PageServer) serveIndex(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	ctx := context.Background()
	repos, err := s.accessibleRepos(ctx, remote, 0)
	if err != nil {
		return mPageError("Could not list repositories")
	}
	owners := map[string]int{}
	for _, r := range repos {
		if r.Owner != nil {
			owners[r.Owner.Name]++
		}
	}
	var b strings.Builder
	b.WriteString("> " + mEscape(s.name) + "\n\n")
	b.WriteString(mLink("Node", pageIndex, nil) + " /\n\n")
	if len(owners) == 0 {
		b.WriteString("No accessible repositories\n")
		return []byte(b.String())
	}
	names := make([]string, 0, len(owners))
	for name := range owners {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		b.WriteString("`a  ")
		b.WriteString(mLink(name, pageGroup, map[string]string{"g": name}))
		b.WriteString("`a\n")
	}
	return []byte(b.String())
}

func (s *PageServer) serveGroup(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	group := pageVars(data)["g"]
	if group == "" {
		return mPageError("No group specified")
	}
	ctx := context.Background()
	owner, err := user_model.GetUserByName(ctx, group)
	if err != nil {
		return mPageError("Group not found")
	}
	repos, err := s.accessibleRepos(ctx, remote, owner.ID)
	if err != nil {
		return mPageError("Could not list repositories")
	}
	var b strings.Builder
	b.WriteString("> " + mEscape(group) + "\n\n")
	b.WriteString(mLink("Node", pageIndex, nil) + " /\n\n")
	if len(repos) == 0 {
		b.WriteString("No accessible repositories\n")
		return []byte(b.String())
	}
	for _, r := range repos {
		b.WriteString("`a  ")
		b.WriteString(mLink(r.Name, pageRepo, repoVars(group, r.Name)))
		if r.Description != "" {
			b.WriteString("`a  " + mEscape(strings.SplitN(r.Description, "\n", 2)[0]))
		}
		b.WriteString("`a\n")
	}
	return []byte(b.String())
}

// repoPage resolves vars g/r to a repository the remote may read, reusing the
// rngit permission resolution.
func (s *PageServer) repoPage(ctx context.Context, remote *identity.Identity, vars map[string]string) (*resolvedRepo, []byte) {
	group, repo := vars["g"], vars["r"]
	if group == "" || repo == "" {
		return nil, mPageError("No repository specified")
	}
	rr, err := resolveRepo(ctx, remote, group+"/"+repo, 0)
	if err != nil {
		return nil, mPageError("Repository not found")
	}
	return rr, nil
}

func (s *PageServer) serveRepo(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	vars := pageVars(data)
	ctx := context.Background()
	rr, errBody := s.repoPage(ctx, remote, vars)
	if errBody != nil {
		return errBody
	}
	ref := s.git.SymbolicRef(rr.gitDir, "HEAD")
	if ref == "" {
		ref = "HEAD"
	}
	var b strings.Builder
	b.WriteString("> " + mEscape(rr.repo.FullName()) + "\n\n")
	b.WriteString(mLink("Node", pageIndex, nil) + " / " +
		mLink(rr.owner.Name, pageGroup, map[string]string{"g": rr.owner.Name}) + "\n\n")
	if rr.repo.Description != "" {
		b.WriteString(mEscape(rr.repo.Description) + "\n\n")
	}
	b.WriteString("`a  " + mLink("Files", pageTree, mergeVars(repoVars(rr.owner.Name, rr.repo.Name), "ref", ref)))
	b.WriteString("`a  " + mLink("Commits", pageCommits, mergeVars(repoVars(rr.owner.Name, rr.repo.Name), "ref", ref)))
	b.WriteString("`a  " + mLink("Refs", pageRefs, repoVars(rr.owner.Name, rr.repo.Name)))
	b.WriteString("`a\n\n")
	if n := s.git.CommitCount(rr.gitDir, ref); n > 0 {
		b.WriteString(fmt.Sprintf("%d commits\n\n", n))
	}
	if readme, _, ok := s.git.Readme(rr.gitDir, ref); ok && readme != "" {
		b.WriteString("-\n\n")
		lines := strings.Split(readme, "\n")
		if len(lines) > 80 {
			lines = lines[:80]
		}
		b.WriteString(mEscape(strings.Join(lines, "\n")))
		b.WriteString("\n")
	}
	return []byte(b.String())
}

func mergeVars(m map[string]string, k, v string) map[string]string {
	out := make(map[string]string, len(m)+1)
	for kk, vv := range m {
		out[kk] = vv
	}
	out[k] = v
	return out
}

func (s *PageServer) serveTree(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	vars := pageVars(data)
	ctx := context.Background()
	rr, errBody := s.repoPage(ctx, remote, vars)
	if errBody != nil {
		return errBody
	}
	ref := vars["ref"]
	if ref == "" {
		ref = "HEAD"
	}
	dirPath := strings.TrimPrefix(vars["path"], "/")
	entries, err := s.git.LsTree(rr.gitDir, ref, dirPath)
	if err != nil {
		return mPageError("Could not list tree")
	}
	vars["path"] = dirPath
	base := repoVars(rr.owner.Name, rr.repo.Name)
	var b strings.Builder
	b.WriteString("> " + mEscape(rr.repo.FullName()+":/"+dirPath) + "\n\n")
	b.WriteString(mLink("Repo", pageRepo, base) + " / " +
		mLink("Commits", pageCommits, mergeVars(base, "ref", ref)) + "\n\n")
	page, _ := strconv.Atoi(vars["page"])
	if page < 1 {
		page = 1
	}
	start := (page - 1) * treePageSize
	if start >= len(entries) && len(entries) > 0 {
		start = 0
	}
	end := start + treePageSize
	if end > len(entries) {
		end = len(entries)
	}
	for _, e := range entries[start:end] {
		child := e.Name
		if dirPath != "" {
			child = dirPath + "/" + e.Name
		}
		switch e.Type {
		case "tree", "commit":
			b.WriteString("`a  " + mLink(e.Name+"/", pageTree, mergeVars(mergeVars(base, "ref", ref), "path", child)))
		default:
			b.WriteString("`a  " + mLink(e.Name, pageBlob, mergeVars(mergeVars(base, "ref", ref), "path", child)))
		}
		b.WriteString("`a\n")
	}
	if end < len(entries) {
		next := mergeVars(mergeVars(base, "ref", ref), "path", dirPath)
		next["page"] = strconv.Itoa(page + 1)
		b.WriteString("\n" + mLink("Next page", pageTree, next) + "\n")
	}
	return []byte(b.String())
}

func (s *PageServer) serveBlob(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	vars := pageVars(data)
	ctx := context.Background()
	rr, errBody := s.repoPage(ctx, remote, vars)
	if errBody != nil {
		return errBody
	}
	ref := vars["ref"]
	if ref == "" {
		ref = "HEAD"
	}
	filePath := strings.TrimPrefix(vars["path"], "/")
	if filePath == "" {
		return mPageError("No file specified")
	}
	info, err := s.git.BlobInfo(rr.gitDir, ref, filePath)
	if err != nil || info == nil {
		return mPageError("File not found")
	}
	base := repoVars(rr.owner.Name, rr.repo.Name)
	var b strings.Builder
	b.WriteString("> " + mEscape(rr.repo.FullName()+":/"+filePath) + "\n\n")
	b.WriteString(mLink("Repo", pageRepo, base) + " / " +
		mLink("Tree", pageTree, mergeVars(mergeVars(base, "ref", ref), "path", dirOf(filePath))) + "\n\n")
	if info.Size > blobLimit {
		b.WriteString(fmt.Sprintf("File too large to display (%d bytes)\n", info.Size))
		return []byte(b.String())
	}
	content, err := s.git.ShowBlob(rr.gitDir, ref, filePath)
	if err != nil {
		return mPageError("Could not read file")
	}
	b.WriteString("-\n\n")
	b.WriteString("```\n")
	b.WriteString(strings.TrimRight(string(content), "\n"))
	b.WriteString("\n```\n")
	return []byte(b.String())
}

func dirOf(p string) string {
	if i := strings.LastIndexByte(p, '/'); i >= 0 {
		return p[:i]
	}
	return ""
}

func (s *PageServer) serveCommits(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	vars := pageVars(data)
	ctx := context.Background()
	rr, errBody := s.repoPage(ctx, remote, vars)
	if errBody != nil {
		return errBody
	}
	ref := vars["ref"]
	if ref == "" {
		ref = "HEAD"
	}
	page, _ := strconv.Atoi(vars["page"])
	skip := page * commitsPageSize
	entries, err := s.git.Log(rr.gitDir, ref, "", skip, commitsPageSize)
	if err != nil {
		return mPageError("Could not list commits")
	}
	base := repoVars(rr.owner.Name, rr.repo.Name)
	var b strings.Builder
	b.WriteString("> " + mEscape(rr.repo.FullName()) + " commits\n\n")
	b.WriteString(mLink("Repo", pageRepo, base) + " /\n\n")
	for _, e := range entries {
		ts := time.Unix(e.UnixTime, 0).UTC().Format("2006-01-02")
		b.WriteString(fmt.Sprintf("`a%s `a", ts))
		b.WriteString(mLink(e.Subject, pageCommit, mergeVars(base, "h", e.SHA)))
		b.WriteString("`a  " + mEscape(e.Author) + "`a\n")
	}
	if len(entries) == commitsPageSize {
		next := mergeVars(base, "ref", ref)
		next["page"] = strconv.Itoa(page + 1)
		b.WriteString("\n" + mLink("Next page", pageCommits, next) + "\n")
	}
	return []byte(b.String())
}

func (s *PageServer) serveCommit(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	vars := pageVars(data)
	ctx := context.Background()
	rr, errBody := s.repoPage(ctx, remote, vars)
	if errBody != nil {
		return errBody
	}
	sha := rnsgit.SanSHA(vars["h"])
	if sha == "" {
		return mPageError("No commit specified")
	}
	d, err := s.git.CommitDetail(rr.gitDir, sha)
	if err != nil {
		return mPageError("Commit not found")
	}
	base := repoVars(rr.owner.Name, rr.repo.Name)
	var b strings.Builder
	b.WriteString("> commit " + sha[:12] + "\n\n")
	b.WriteString(mLink("Repo", pageRepo, base) + " / " +
		mLink("Commits", pageCommits, mergeVars(base, "ref", sha)) + "\n\n")
	b.WriteString(mEscape(d.Subject) + "\n\n")
	b.WriteString(mEscape(d.Author) + "  " + time.Unix(d.AuthorTS, 0).UTC().Format("2006-01-02 15:04 UTC") + "\n\n")
	if d.Body != "" {
		b.WriteString("-\n\n" + mEscape(strings.TrimSpace(d.Body)) + "\n")
	}
	return []byte(b.String())
}

func (s *PageServer) serveRefs(_ string, data, _, _ []byte, remote *identity.Identity, _ int64) any {
	vars := pageVars(data)
	ctx := context.Background()
	rr, errBody := s.repoPage(ctx, remote, vars)
	if errBody != nil {
		return errBody
	}
	refs, err := s.git.ForEachRef(rr.gitDir)
	if err != nil {
		return mPageError("Could not list refs")
	}
	base := repoVars(rr.owner.Name, rr.repo.Name)
	var b strings.Builder
	b.WriteString("> " + mEscape(rr.repo.FullName()) + " refs\n\n")
	b.WriteString(mLink("Repo", pageRepo, base) + " /\n\n")
	for _, r := range refs {
		if !strings.HasPrefix(r.RefName, "refs/heads/") && !strings.HasPrefix(r.RefName, "refs/tags/") {
			continue
		}
		b.WriteString("`a  ")
		b.WriteString(mLink(r.Short, pageTree, mergeVars(mergeVars(base, "ref", r.Short), "path", "")))
		b.WriteString("`a  " + mEscape(r.RefName) + "`a\n")
	}
	return []byte(b.String())
}
