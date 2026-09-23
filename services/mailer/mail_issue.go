// Copyright 2019 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package mailer

import (
	"context"
	"fmt"

	activities_model "forgejo.org/models/activities"
	issues_model "forgejo.org/models/issues"
	access_model "forgejo.org/models/perm/access"
	repo_model "forgejo.org/models/repo"
	"forgejo.org/models/unit"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/container"
	"forgejo.org/modules/log"
)

func fallbackMailSubject(issue *issues_model.Issue) string {
	if issue.IsPull {
		return fmt.Sprintf("[%s] %s (PR #%d)", issue.Repo.FullName(), issue.Title, issue.Index)
	}
	return fmt.Sprintf("[%s] %s (Issue #%d)", issue.Repo.FullName(), issue.Title, issue.Index)
}

type ActionAdditionalData interface {
	isActionAdditionalData()
}

type ActionCloseIssueByCommit struct {
	CommitID string
	Repo     *repo_model.Repository
}

func (ActionCloseIssueByCommit) isActionAdditionalData() {}

type mailCommentContext struct {
	context.Context
	Issue                 *issues_model.Issue
	Doer                  *user_model.User
	ActionType            activities_model.ActionType
	Content               string
	Comment               *issues_model.Comment
	ForceDoerNotification bool
	ActionAdditionalData  ActionAdditionalData
}

// mailIssueCommentToParticipants can be used for both new issue creation and comment.
// This function sends two list of emails:
// 1. Repository watchers (except for WIP pull requests) and users who are participated in comments.
// 2. Users who are not in 1. but get mentioned in current issue/comment.
func mailIssueCommentToParticipants(ctx *mailCommentContext, mentions []*user_model.User) error {
	// Required by the mail composer; make sure to load these before calling the async function
	if err := ctx.Issue.LoadRepo(ctx); err != nil {
		return fmt.Errorf("LoadRepo: %w", err)
	}
	if err := ctx.Issue.LoadPoster(ctx); err != nil {
		return fmt.Errorf("LoadPoster: %w", err)
	}
	if err := ctx.Issue.LoadPullRequest(ctx); err != nil {
		return fmt.Errorf("LoadPullRequest: %w", err)
	}

	// Enough room to avoid reallocations
	unfiltered := make([]int64, 1, 64)

	// =========== Original poster ===========
	unfiltered[0] = ctx.Issue.PosterID

	// =========== Assignees ===========
	ids, err := issues_model.GetAssigneeIDsByIssue(ctx, ctx.Issue.ID)
	if err != nil {
		return fmt.Errorf("GetAssigneeIDsByIssue(%d): %w", ctx.Issue.ID, err)
	}
	unfiltered = append(unfiltered, ids...)

	// =========== Participants (i.e. commenters, reviewers) ===========
	ids, err = issues_model.GetParticipantsIDsByIssueID(ctx, ctx.Issue.ID)
	if err != nil {
		return fmt.Errorf("GetParticipantsIDsByIssueID(%d): %w", ctx.Issue.ID, err)
	}
	unfiltered = append(unfiltered, ids...)

	// =========== Issue watchers ===========
	ids, err = issues_model.GetIssueWatchersIDs(ctx, ctx.Issue.ID, true)
	if err != nil {
		return fmt.Errorf("GetIssueWatchersIDs(%d): %w", ctx.Issue.ID, err)
	}
	unfiltered = append(unfiltered, ids...)

	// =========== Repo watchers ===========
	// Make repo watchers last, since it's likely the list with the most users
	if !ctx.Issue.IsPull || !ctx.Issue.PullRequest.IsWorkInProgress(ctx) || ctx.ActionType == activities_model.ActionCreatePullRequest {
		ids, err = repo_model.GetSelectWatcherIDs(ctx, ctx.Issue.RepoID, repo_model.WatchSelection{Issues: true, PullRequests: false, Releases: false})
		if err != nil {
			return fmt.Errorf("GetRepoWatchersIDs(%d): %w", ctx.Issue.RepoID, err)
		}
		unfiltered = append(ids, unfiltered...)
	}

	visited := make(container.Set[int64], len(unfiltered)+len(mentions)+1)

	// Avoid mailing the doer
	if ctx.Doer.EmailNotificationsPreference != user_model.EmailNotificationsAndYourOwn && !ctx.ForceDoerNotification {
		visited.Add(ctx.Doer.ID)
	}

	// =========== Mentions ===========
	if err = mailIssueCommentBatch(ctx, mentions, visited, true); err != nil {
		return fmt.Errorf("mailIssueCommentBatch() mentions: %w", err)
	}

	// Avoid mailing explicit unwatched
	ids, err = issues_model.GetIssueWatchersIDs(ctx, ctx.Issue.ID, false)
	if err != nil {
		return fmt.Errorf("GetIssueWatchersIDs(%d): %w", ctx.Issue.ID, err)
	}
	visited.AddMultiple(ids...)

	unfilteredUsers, err := user_model.GetMaileableUsersByIDs(ctx, unfiltered, false)
	if err != nil {
		return err
	}
	if err = mailIssueCommentBatch(ctx, unfilteredUsers, visited, false); err != nil {
		return fmt.Errorf("mailIssueCommentBatch(): %w", err)
	}

	return nil
}

func mailIssueCommentBatch(ctx *mailCommentContext, users []*user_model.User, visited container.Set[int64], fromMention bool) error {
	checkUnit := unit.TypeIssues
	if ctx.Issue.IsPull {
		checkUnit = unit.TypePullRequests
	}

	lxmfUsers := make([]*user_model.User, 0, len(users))
	for _, user := range users {
		if !user.IsActive {
			// Exclude deactivated users
			continue
		}
		// At this point we exclude:
		// user that don't have all notifications enabled or users only get notified on mention and this is one ...
		if user.EmailNotificationsPreference != user_model.EmailNotificationsEnabled &&
			user.EmailNotificationsPreference != user_model.EmailNotificationsAndYourOwn && (!fromMention || user.EmailNotificationsPreference != user_model.EmailNotificationsOnMention) {
			continue
		}

		// if we have already visited this user we exclude them
		if !visited.Add(user.ID) {
			continue
		}

		// test if this user is allowed to see the issue/pull
		if !access_model.CheckRepoUnitUser(ctx, ctx.Issue.Repo, user, checkUnit) {
			continue
		}

		lxmfUsers = append(lxmfUsers, user)
	}

	if len(lxmfUsers) > 0 {
		sendIssueActivityViaLXMF(ctx, lxmfUsers, fromMention)
	}

	return nil
}

// MailParticipants sends new issue thread created emails to repository watchers
// and mentioned people.
func MailParticipants(ctx context.Context, issue *issues_model.Issue, doer *user_model.User, opType activities_model.ActionType, mentions []*user_model.User, additionalData ActionAdditionalData) error {
	content := issue.Content
	if opType == activities_model.ActionCloseIssue || opType == activities_model.ActionClosePullRequest ||
		opType == activities_model.ActionReopenIssue || opType == activities_model.ActionReopenPullRequest ||
		opType == activities_model.ActionMergePullRequest || opType == activities_model.ActionAutoMergePullRequest {
		content = ""
	}
	forceDoerNotification := opType == activities_model.ActionAutoMergePullRequest
	if err := mailIssueCommentToParticipants(
		&mailCommentContext{
			Context:               ctx,
			Issue:                 issue,
			Doer:                  doer,
			ActionType:            opType,
			Content:               content,
			Comment:               nil,
			ForceDoerNotification: forceDoerNotification,
			ActionAdditionalData:  additionalData,
		}, mentions,
	); err != nil {
		log.Error("mailIssueCommentToParticipants: %v", err)
	}
	return nil
}

// sendIssueActivityViaLXMF delivers a compact activity notice to the
// verified Reticulum identities of the users.
func sendIssueActivityViaLXMF(ctx *mailCommentContext, users []*user_model.User, fromMention bool) {
	link := ctx.Issue.HTMLURL()
	if ctx.Comment != nil {
		link += "#" + ctx.Comment.HashTag()
	}

	subject := fallbackMailSubject(ctx.Issue)
	if fromMention {
		subject = "Re: " + subject
	}
	msgs := make([]*Message, 0, len(users))
	for _, u := range users {
		body := subject + "\n\n" + link
		if ctx.Content != "" {
			body = ctx.Content + "\n\n" + link
		}
		msg := newMessage(ctx, u, subject, body, true)
		msg.Info = fmt.Sprintf("UID: %d, issue #%d activity", u.ID, ctx.Issue.ID)
		msgs = append(msgs, msg)
	}
	SendAsync(msgs...)
}
