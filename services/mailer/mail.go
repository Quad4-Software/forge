// Copyright 2016 The Gogs Authors. All rights reserved.
// Copyright 2019 The Gitea Authors. All rights reserved.
// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package mailer

import (
	"context"
	"fmt"
	"html"
	"net/url"

	activities_model "forgejo.org/models/activities"
	auth_model "forgejo.org/models/auth"
	issues_model "forgejo.org/models/issues"
	org_model "forgejo.org/models/organization"
	repo_model "forgejo.org/models/repo"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/log"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/timeutil"
	"forgejo.org/modules/translation"
	"forgejo.org/services/lxmfnotify"
)

// Message is an outbound notification. To identifies the recipient for
// logging and tests. Delivery happens over LXMF to the Reticulum identities
// registered by the recipient user, or directly to an identity hash for
// recipients without an account.
type Message struct {
	To      string
	Subject string
	Body    string
	Info    string

	ctx          context.Context
	user         *user_model.User
	verifiedOnly bool
	identityHash string
}

// SendAsync dispatches notification messages. The default implementation
// delivers them over LXMF. It is a variable so tests can intercept delivery.
var SendAsync = sendAsync

func sendAsync(msgs ...*Message) {
	for _, msg := range msgs {
		deliverMessage(msg)
	}
}

func deliverMessage(msg *Message) {
	ctx := msg.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	if msg.identityHash != "" {
		lxmfnotify.SendToIdentity(msg.identityHash, msg.Subject, msg.Body)
		return
	}
	if msg.user == nil {
		return
	}
	lxmfnotify.SendMessage(ctx, msg.user, msg.Subject, msg.Body, msg.verifiedOnly)
}

func newMessage(ctx context.Context, u *user_model.User, subject, body string, verifiedOnly bool) *Message {
	return &Message{
		To:           u.EmailTo(),
		Subject:      subject,
		Body:         body,
		ctx:          ctx,
		user:         u,
		verifiedOnly: verifiedOnly,
	}
}

// SendActivateAccountMail sends an activation notice to the user (new user
// registration) via LXMF to the registered Reticulum identities.
func SendActivateAccountMail(ctx context.Context, u *user_model.User) error {
	if lxmfnotify.Available() && !lxmfnotify.Deliverable(ctx, u) {
		return fmt.Errorf("user %d has no Reticulum identity for activation delivery", u.ID)
	}
	locale := translation.NewLocale(u.Language)
	code, err := u.GenerateEmailAuthorizationCode(ctx, auth_model.UserActivation)
	if err != nil {
		return err
	}
	activateURL := fmt.Sprintf("%suser/activate?code=%s", setting.AppURL, url.QueryEscape(code))
	msg := newMessage(ctx, u, locale.TrString("mail.activate_account"),
		fmt.Sprintf("%s\n%s %s",
			locale.TrString("mail.activate_account.text_1", u.DisplayName(), setting.AppName),
			locale.TrString("mail.activate_account.text_2", timeutil.MinutesToFriendly(setting.Service.ActiveCodeLives, locale)),
			activateURL), false)
	msg.Info = fmt.Sprintf("UID: %d, activation code", u.ID)
	SendAsync(msg)
	return nil
}

// SendResetPasswordMail sends a password reset notice to the user via LXMF.
func SendResetPasswordMail(ctx context.Context, u *user_model.User) error {
	if lxmfnotify.Available() && !lxmfnotify.Deliverable(ctx, u) {
		return fmt.Errorf("user %d has no Reticulum identity for reset delivery", u.ID)
	}
	locale := translation.NewLocale(u.Language)
	code, err := u.GenerateEmailAuthorizationCode(ctx, auth_model.PasswordReset)
	if err != nil {
		return err
	}
	recoverURL := fmt.Sprintf("%suser/recover_account?code=%s", setting.AppURL, url.QueryEscape(code))
	msg := newMessage(ctx, u, locale.TrString("mail.reset_password"),
		fmt.Sprintf("%s\n%s %s",
			locale.TrString("mail.reset_password.text", timeutil.MinutesToFriendly(setting.Service.ResetPwdCodeLives, locale)),
			locale.TrString("mail.link_not_working_do_paste"),
			recoverURL), false)
	msg.Info = fmt.Sprintf("UID: %d, reset password code", u.ID)
	SendAsync(msg)
	return nil
}

// SendRegisterNotifyMail notifies a user about an admin-created account.
func SendRegisterNotifyMail(ctx context.Context, u *user_model.User) {
	if !u.IsActive {
		return
	}
	locale := translation.NewLocale(u.Language)
	subject := locale.TrString("mail.register_notify", setting.AppName)
	msg := newMessage(ctx, u, subject, subject+"\n\n"+setting.AppURL, true)
	msg.Info = fmt.Sprintf("UID: %d, registration notify", u.ID)
	SendAsync(msg)
}

// SendCollaboratorMail notifies a user that they were added as collaborator.
func SendCollaboratorMail(ctx context.Context, u, doer *user_model.User, repo *repo_model.Repository) {
	if !u.IsActive {
		return
	}
	locale := translation.NewLocale(u.Language)
	subject := locale.TrString("mail.repo.collaborator.added.subject", doer.DisplayName(), repo.FullName())
	msg := newMessage(ctx, u, subject, subject+"\n\n"+repo.HTMLURL(), true)
	msg.Info = fmt.Sprintf("UID: %d, collaborator added to %s", u.ID, repo.FullName())
	SendAsync(msg)
}

// deliverNotice routes a notice to the verified Reticulum identities of a
// user.
func deliverNotice(ctx context.Context, u *user_model.User, subject, content string) {
	msg := newMessage(ctx, u, subject, content, true)
	msg.Info = fmt.Sprintf("UID: %d, %s", u.ID, subject)
	SendAsync(msg)
}

// SendIssueAssignedMail sends issue assigned notifications via LXMF.
func SendIssueAssignedMail(ctx context.Context, issue *issues_model.Issue, doer *user_model.User, content string, comment *issues_model.Comment, recipients []*user_model.User) error {
	if err := issue.LoadRepo(ctx); err != nil {
		log.Error("Unable to load repo [%d] for issue #%d [%d]. Error: %v", issue.RepoID, issue.Index, issue.ID, err)
		return err
	}

	lxmfUsers := make([]*user_model.User, 0, len(recipients))
	for _, user := range recipients {
		if user.IsActive {
			lxmfUsers = append(lxmfUsers, user)
		}
	}
	if len(lxmfUsers) == 0 {
		return nil
	}

	sendIssueActivityViaLXMF(&mailCommentContext{
		Context:    ctx,
		Issue:      issue,
		Doer:       doer,
		ActionType: activities_model.ActionType(0),
		Content:    content,
		Comment:    comment,
	}, lxmfUsers, false)
	return nil
}

// sendSecurityNotice delivers a localized security notice to the verified
// identities of the user.
func sendSecurityNotice(ctx context.Context, u *user_model.User, subject, body, info string) {
	msg := newMessage(ctx, u, subject, body, true)
	msg.Info = info
	SendAsync(msg)
}

func securityNoticeSuffix(locale translation.Locale) string {
	return "\n" + locale.TrString("mail.security_notice_hint", setting.AppName, setting.AppURL)
}

// SendPasswordChange informs the user that their password was changed.
func SendPasswordChange(ctx context.Context, u *user_model.User) error {
	locale := translation.NewLocale(u.Language)
	sendSecurityNotice(ctx, u,
		locale.TrString("mail.password_change.subject"),
		locale.TrString("mail.password_change.text_1")+securityNoticeSuffix(locale),
		fmt.Sprintf("UID: %d, password change notification", u.ID))
	return nil
}

// SendDisabledTOTP informs the user that their totp has been disabled.
func SendDisabledTOTP(ctx context.Context, u *user_model.User) error {
	locale := translation.NewLocale(u.Language)
	hasWebAuthn, err := auth_model.HasWebAuthnRegistrationsByUID(ctx, u.ID)
	if err != nil {
		return err
	}
	body := locale.TrString("mail.totp_disabled.text_1")
	if !hasWebAuthn {
		body += "\n" + locale.TrString("mail.totp_disabled.no_2fa")
	}
	sendSecurityNotice(ctx, u,
		locale.TrString("mail.totp_disabled.subject"),
		body+securityNoticeSuffix(locale),
		fmt.Sprintf("UID: %d, 2fa disabled notification", u.ID))
	return nil
}

// SendRemovedSecurityKey informs the user that one of their security keys has been removed.
func SendRemovedSecurityKey(ctx context.Context, u *user_model.User, securityKeyName string) error {
	locale := translation.NewLocale(u.Language)
	hasTwoFactor, err := auth_model.HasTwoFactorByUID(ctx, u.ID)
	if err != nil {
		return err
	}
	body := locale.TrString("mail.removed_security_key.text_1", html.EscapeString(securityKeyName))
	if !hasTwoFactor {
		body += "\n" + locale.TrString("mail.removed_security_key.no_2fa")
	}
	sendSecurityNotice(ctx, u,
		locale.TrString("mail.removed_security_key.subject"),
		body+securityNoticeSuffix(locale),
		fmt.Sprintf("UID: %d, security key removed notification", u.ID))
	return nil
}

// SendTOTPEnrolled informs the user that they've been enrolled into TOTP.
func SendTOTPEnrolled(ctx context.Context, u *user_model.User) error {
	locale := translation.NewLocale(u.Language)
	hasWebAuthn, err := auth_model.HasWebAuthnRegistrationsByUID(ctx, u.ID)
	if err != nil {
		return err
	}
	bodyKey := "mail.totp_enrolled.text_1.no_webauthn"
	if hasWebAuthn {
		bodyKey = "mail.totp_enrolled.text_1.has_webauthn"
	}
	sendSecurityNotice(ctx, u,
		locale.TrString("mail.totp_enrolled.subject"),
		locale.TrString(bodyKey)+securityNoticeSuffix(locale),
		fmt.Sprintf("UID: %d, enrolled into TOTP notification", u.ID))
	return nil
}

// MailTeamInvite delivers a team invitation to an existing user via LXMF to
// their verified Reticulum identities. The invite token is a bearer
// credential delivered inside an encrypted LXMF message.
func MailTeamInvite(ctx context.Context, inviter *user_model.User, team *org_model.Team, invite *org_model.TeamInvite) error {
	org, err := user_model.GetUserByID(ctx, team.OrgID)
	if err != nil {
		return err
	}
	if err := invite.LoadInvitedUser(ctx); err != nil {
		return err
	}
	user := invite.InvitedUser
	if user == nil {
		return fmt.Errorf("team invite %d has no invited user", invite.ID)
	}
	if user.ProhibitLogin {
		return fmt.Errorf("login is prohibited for the invited user")
	}

	locale := translation.NewLocale(user.Language)
	inviteURL := fmt.Sprintf("%suser/login?redirect_to=%s", setting.AppURL,
		url.QueryEscape(fmt.Sprintf("/org/invite/%s", invite.Token)))
	subject := locale.TrString("mail.team_invite.subject", inviter.DisplayName(), org.DisplayName())
	body := fmt.Sprintf("%s\n%s %s\n%s",
		locale.TrString("mail.team_invite.text_1", inviter.DisplayName(), team.Name, org.DisplayName()),
		locale.TrString("mail.team_invite.text_2"),
		inviteURL,
		locale.TrString("mail.team_invite.text_3", user.DisplayName()))
	msg := newMessage(ctx, user, subject, body, true)
	msg.To = user.Email
	msg.Info = fmt.Sprintf("UID: %d, team invite to %s/%s", user.ID, org.Name, team.Name)
	SendAsync(msg)
	return nil
}

// MailTeamInviteToIdentity delivers a team invitation to a Reticulum
// identity that has no account yet.
func MailTeamInviteToIdentity(ctx context.Context, inviter *user_model.User, team *org_model.Team, invite *org_model.TeamInvite, identityHash string) error {
	org, err := user_model.GetUserByID(ctx, team.OrgID)
	if err != nil {
		return err
	}
	locale := translation.NewLocale(inviter.Language)
	inviteURL := fmt.Sprintf("%suser/sign_up?redirect_to=%s", setting.AppURL,
		url.QueryEscape("/org/invite/"+invite.Token))
	msg := &Message{
		To:      identityHash,
		Subject: locale.TrString("mail.team_invite.subject", inviter.DisplayName(), org.DisplayName()),
		Body: fmt.Sprintf("%s\n%s %s",
			locale.TrString("mail.team_invite.text_1", inviter.DisplayName(), team.Name, org.DisplayName()),
			locale.TrString("mail.team_invite.text_2"),
			inviteURL),
		Info:         fmt.Sprintf("team invite for %s/%s to identity %s", org.Name, team.Name, identityHash),
		ctx:          ctx,
		identityHash: identityHash,
	}
	SendAsync(msg)
	return nil
}
