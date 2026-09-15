// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

// Package lxmfnotify delivers account messages such as activation codes,
// password resets, security notices and team invitations over LXMF to the
// Reticulum identities registered by users. It is the LXMF counterpart of
// services/mailer and is used when a user has no deliverable email address
// or when the instance runs in email-optional mode.
package lxmfnotify

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	auth_model "forgejo.org/models/auth"
	org_model "forgejo.org/models/organization"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/graceful"
	"forgejo.org/modules/log"
	"forgejo.org/modules/rns"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/timeutil"
	"forgejo.org/modules/translation"
)

// Available reports whether LXMF delivery is enabled and the node is running.
func Available() bool {
	return Configured() && rns.Enabled()
}

// Configured reports whether LXMF delivery is enabled in the configuration,
// regardless of whether the Reticulum node has finished starting.
func Configured() bool {
	return setting.RNS.Enabled && setting.RNS.EnableLXMF
}

// HasPlaceholderEmail reports whether the user email is a generated no-reply
// placeholder rather than a deliverable address.
func HasPlaceholderEmail(u *user_model.User) bool {
	return u.Email == "" || strings.HasSuffix(strings.ToLower(u.Email), "@"+strings.ToLower(setting.Service.NoReplyAddress))
}

// Deliverable reports whether the user can be reached over LXMF, meaning at
// least one Reticulum identity is registered. Verification is not required
// here because possession of the identity private key is what the delivered
// codes and tokens prove.
func Deliverable(ctx context.Context, u *user_model.User) bool {
	if !Available() {
		return false
	}
	keys, err := user_model.GetRNSKeysByUserID(ctx, u.ID)
	return err == nil && len(keys) > 0
}

// DeliverableVerified reports whether the user can be reached over LXMF
// through a verified identity. Used for security notices which must not go
// to unverified contact points.
func DeliverableVerified(ctx context.Context, u *user_model.User) bool {
	if !Available() {
		return false
	}
	keys, err := user_model.GetRNSKeysByUserID(ctx, u.ID)
	if err != nil {
		return false
	}
	for _, k := range keys {
		if k.Verified {
			return true
		}
	}
	return false
}

// identityHashes returns the identity hashes of the user. When verifiedOnly is
// set only verified identities are returned.
func identityHashes(ctx context.Context, u *user_model.User, verifiedOnly bool) []string {
	keys, err := user_model.GetRNSKeysByUserID(ctx, u.ID)
	if err != nil {
		return nil
	}
	hashes := make([]string, 0, len(keys))
	for _, k := range keys {
		if verifiedOnly && !k.Verified {
			continue
		}
		hashes = append(hashes, k.IdentityHash)
	}
	return hashes
}

func sendAll(hashes []string, subject, content string) {
	for _, h := range hashes {
		hash := h
		go graceful.GetManager().RunWithShutdownContext(func(ctx context.Context) {
			if err := rns.SendLXMFText(hash, subject, content); err != nil {
				log.Error("LXMF delivery to <%s> failed: %v", hash, err)
			}
		})
	}
}

// SendActivateAccount sends the account activation code over LXMF.
func SendActivateAccount(ctx context.Context, u *user_model.User) error {
	if !Available() {
		return fmt.Errorf("lxmf delivery is not enabled")
	}
	hashes := identityHashes(ctx, u, false)
	if len(hashes) == 0 {
		return fmt.Errorf("user has no Reticulum identity")
	}
	locale := translation.NewLocale(u.Language)
	code, err := u.GenerateEmailAuthorizationCode(ctx, auth_model.UserActivation)
	if err != nil {
		return err
	}
	activateURL := fmt.Sprintf("%suser/activate?code=%s", setting.AppURL, url.QueryEscape(code))
	subject := locale.TrString("mail.activate_account")
	content := fmt.Sprintf("%s\n%s %s",
		locale.TrString("mail.activate_account.text_1", u.DisplayName(), setting.AppName),
		locale.TrString("mail.activate_account.text_2", timeutil.MinutesToFriendly(setting.Service.ActiveCodeLives, locale)),
		activateURL)
	sendAll(hashes, subject, content)
	return nil
}

// SendResetPassword sends a password reset code over LXMF.
func SendResetPassword(ctx context.Context, u *user_model.User) error {
	if !Available() {
		return fmt.Errorf("lxmf delivery is not enabled")
	}
	hashes := identityHashes(ctx, u, false)
	if len(hashes) == 0 {
		return fmt.Errorf("user has no Reticulum identity")
	}
	locale := translation.NewLocale(u.Language)
	code, err := u.GenerateEmailAuthorizationCode(ctx, auth_model.PasswordReset)
	if err != nil {
		return err
	}
	recoverURL := fmt.Sprintf("%suser/recover_account?code=%s", setting.AppURL, url.QueryEscape(code))
	subject := locale.TrString("mail.reset_password")
	content := fmt.Sprintf("%s\n%s %s",
		locale.TrString("mail.reset_password.text", timeutil.MinutesToFriendly(setting.Service.ResetPwdCodeLives, locale)),
		locale.TrString("mail.link_not_working_do_paste"),
		recoverURL)
	sendAll(hashes, subject, content)
	return nil
}

// SendIssueActivity sends a compact issue or pull request activity notice to
// the verified identities of the user.
func SendIssueActivity(u *user_model.User, hashes []string, subject, link string) {
	if !Available() || len(hashes) == 0 {
		return
	}
	content := fmt.Sprintf("%s\n\n%s", subject, link)
	sendAll(hashes, subject, content)
}

// SendSecurityNotice sends a plain security notice to all verified
// identities of the user.
func SendSecurityNotice(ctx context.Context, u *user_model.User, subject, content string) {
	if !Available() {
		return
	}
	hashes := identityHashes(ctx, u, true)
	if len(hashes) == 0 {
		return
	}
	sendAll(hashes, subject, content)
}

// SendTeamInvite delivers a team invitation to a Reticulum identity that has
// no account yet. The invite token is a bearer credential delivered inside an
// encrypted LXMF message.
func SendTeamInvite(ctx context.Context, inviter *user_model.User, team *org_model.Team, invite *org_model.TeamInvite, identityHash string) error {
	if !Available() {
		return fmt.Errorf("lxmf delivery is not enabled")
	}
	org, err := user_model.GetUserByID(ctx, team.OrgID)
	if err != nil {
		return err
	}
	locale := translation.NewLocale(inviter.Language)
	inviteURL := fmt.Sprintf("%suser/sign_up?redirect_to=%s", setting.AppURL, url.QueryEscape("/org/invite/"+invite.Token))
	subject := locale.TrString("mail.team_invite.subject", inviter.DisplayName(), org.DisplayName())
	content := fmt.Sprintf("%s\n%s %s",
		locale.TrString("mail.team_invite.text_1", inviter.DisplayName(), team.Name, org.DisplayName()),
		locale.TrString("mail.team_invite.text_2"),
		inviteURL)
	sendAll([]string{identityHash}, subject, content)
	return nil
}
