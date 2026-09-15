// Copyright 2024 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"context"
	"fmt"

	repo_model "forgejo.org/models/repo"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/cache"
	"forgejo.org/modules/git"
	"forgejo.org/modules/log"
)

// CompareInfo represents the collected results from ParseCompareInfo
type CompareInfo struct {
	HeadUser         *user_model.User
	HeadRepo         *repo_model.Repository
	HeadGitRepo      *git.Repository
	CompareInfo      *git.CompareInfo
	BaseBranch       string
	HeadBranch       string
	DirectComparison bool
}

// GetCompareInfoCached resolves the compared refs to commit IDs and caches the
// result of GetCompareInfo on those immutable IDs, so repeated requests for
// the same refs skip the fetch, merge-base, log and diff-name-only work. If
// either ref cannot be resolved the computation runs uncached.
func GetCompareInfoCached(ctx context.Context, baseRepo, headRepo *repo_model.Repository, headGitRepo *git.Repository, baseBranchRef, headBranchRef string, directComparison, fileOnly bool) (*git.CompareInfo, error) {
	getFunc := func() (*git.CompareInfo, error) {
		return headGitRepo.GetCompareInfo(baseRepo.RepoPath(), baseBranchRef, headBranchRef, directComparison, fileOnly)
	}

	baseCommitSHA, baseErr := git.GetFullCommitID(ctx, baseRepo.RepoPath(), baseBranchRef)
	headCommitSHA, headErr := git.GetFullCommitID(ctx, headGitRepo.Path, headBranchRef)
	if baseErr != nil || headErr != nil {
		return getFunc()
	}

	cacheKey := fmt.Sprintf("CompareInfo;BaseRepo=%d;HeadRepo=%d;Base=%s;Head=%s;Direct=%t;FileOnly=%t",
		baseRepo.ID, headRepo.ID, baseCommitSHA, headCommitSHA, directComparison, fileOnly)
	compareInfo, err := cache.Get(cacheKey, getFunc)
	if compareInfo != nil && err != nil {
		// A computed result with an error means the value could not be stored
		// (e.g. the cache adapter cannot serialize it); serve it anyway.
		log.Warn("GetCompareInfo: unable to cache result: %v", err)
		return compareInfo, nil
	}
	return compareInfo, err
}
