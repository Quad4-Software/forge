// Copyright 2021 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package mailer

import (
	"context"
	"slices"

	access_model "forgejo.org/models/perm/access"
	repo_model "forgejo.org/models/repo"
	"forgejo.org/models/unit"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/log"
	"forgejo.org/modules/translation"
	"forgejo.org/services/lxmfnotify"
)

// MailNewRelease send new release notifications to all repo watchers via LXMF.
func MailNewRelease(ctx context.Context, rel *repo_model.Release) {
	if !lxmfnotify.Available() {
		return
	}

	watcherIDList, err := repo_model.GetSelectWatcherIDs(ctx, rel.RepoID, repo_model.WatchSelection{Issues: false, PullRequests: false, Releases: true})
	if err != nil {
		log.Error("GetRepoWatchersIDs(%d): %v", rel.RepoID, err)
		return
	}

	recipients, err := user_model.GetMaileableUsersByIDs(ctx, watcherIDList, false)
	if err != nil {
		log.Error("user_model.GetMaileableUsersByIDs: %v", err)
		return
	}

	// Users are not eligible to receive this notice if they are not active or
	// they don't have permissions to read releases.
	recipients = slices.DeleteFunc(recipients, func(u *user_model.User) bool {
		return !u.IsActive || u.ID == rel.PublisherID || !access_model.CheckRepoUnitUser(ctx, rel.Repo, u, unit.TypeReleases)
	})

	for _, u := range recipients {
		locale := translation.NewLocale(u.Language)
		subject := locale.TrString("mail.release.new.subject", rel.TagName, rel.Repo.FullName())
		deliverNotice(ctx, u, subject, subject+"\n\n"+rel.HTMLURL())
	}
}
