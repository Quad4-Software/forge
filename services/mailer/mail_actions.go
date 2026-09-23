// Copyright 2023 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package mailer

import (
	"context"
	"fmt"

	actions_model "forgejo.org/models/actions"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/translation"
	"forgejo.org/services/lxmfnotify"
)

var sendActionRunJobFailureNotification = func(ctx context.Context, job *actions_model.ActionRunJob) error {
	if !job.Status.IsFailure() {
		return nil
	}

	if !lxmfnotify.Available() {
		return nil
	}

	if !job.Run.NotifyEmail {
		return nil
	}

	user := job.Run.TriggerUser
	// this happens e.g. when this is a scheduled run
	if user.IsSystem() {
		user = job.Run.Repo.Owner
	}
	if user.IsSystem() || user.Email == "" {
		return nil
	}

	if user.EmailNotificationsPreference == user_model.EmailNotificationsDisabled {
		return nil
	}

	jobLink, err := job.HTMLURL(ctx)
	if err != nil {
		return fmt.Errorf("could not generate link to job results: %w", err)
	}

	locale := translation.NewLocale(user.Language)
	subject := fmt.Sprintf("[%[1]s] %s", job.Run.Repo.FullName(),
		locale.TrString("mail.actions.job_failure_subject", job.Name))
	deliverNotice(ctx, user, subject, subject+"\n\n"+jobLink)

	return nil
}
