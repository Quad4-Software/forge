// Copyright 2021 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package mailer

import (
	"context"

	"forgejo.org/models/organization"
	repo_model "forgejo.org/models/repo"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/translation"
	"forgejo.org/services/lxmfnotify"
)

// SendRepoTransferNotifyMail sends a notification when a pending repository
// transfer was created, delivered via LXMF.
func SendRepoTransferNotifyMail(ctx context.Context, doer, newOwner *user_model.User, repo *repo_model.Repository) error {
	if !lxmfnotify.Available() {
		return nil
	}

	tos := []*user_model.User{newOwner}
	if newOwner.IsOrganization() {
		userMap, err := organization.GetUsersWhoCanCreateOrgRepo(ctx, newOwner.ID)
		if err != nil {
			return err
		}
		tos = make([]*user_model.User, 0, len(userMap))
		for _, u := range userMap {
			tos = append(tos, u)
		}
	}

	for _, to := range tos {
		if !to.IsActive {
			continue
		}
		locale := translation.NewLocale(to.Language)
		destination := locale.TrString("mail.repo.transfer.to_you")
		subject := locale.TrString("mail.repo.transfer.subject_to_you", doer.DisplayName(), repo.FullName())
		if newOwner.IsOrganization() {
			destination = newOwner.DisplayName()
			subject = locale.TrString("mail.repo.transfer.subject_to", doer.DisplayName(), repo.FullName(), destination)
		}
		deliverNotice(ctx, to, subject, subject+"\n\n"+repo.HTMLURL())
	}

	return nil
}
