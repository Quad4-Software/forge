// Copyright 2023 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT
package mailer

import (
	"context"
	"strconv"

	user_model "forgejo.org/models/user"
	"forgejo.org/modules/log"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/translation"
	"forgejo.org/services/lxmfnotify"
)

// MailNewUser sends notifications on new user registrations to all admins
func MailNewUser(ctx context.Context, u *user_model.User) {
	if !setting.Admin.SendNotificationEmailOnNewUser || !lxmfnotify.Available() {
		return
	}

	recipients, err := user_model.GetAllAdmins(ctx)
	if err != nil {
		log.Error("user_model.GetAllAdmins: %v", err)
		return
	}

	manageUserURL := setting.AppURL + "admin/users/" + strconv.FormatInt(u.ID, 10)
	for _, admin := range recipients {
		locale := translation.NewLocale(admin.Language)
		subject := locale.TrString("mail.admin.new_user.subject", u.Name)
		deliverNotice(ctx, admin, subject, locale.TrString("mail.admin.new_user.text", manageUserURL))
	}
}
