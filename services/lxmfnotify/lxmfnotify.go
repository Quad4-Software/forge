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
	"strings"

	user_model "forgejo.org/models/user"
	"forgejo.org/modules/graceful"
	"forgejo.org/modules/log"
	"forgejo.org/modules/rns"
	"forgejo.org/modules/setting"
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

// SendMessage delivers a subject and content message to the Reticulum
// identities of the user. When verifiedOnly is set only verified identities
// receive the message.
func SendMessage(ctx context.Context, u *user_model.User, subject, content string, verifiedOnly bool) {
	if !Available() {
		return
	}
	hashes := identityHashes(ctx, u, verifiedOnly)
	if len(hashes) == 0 {
		return
	}
	sendAll(hashes, subject, content)
}

// SendToIdentity delivers a subject and content message directly to a
// Reticulum identity hash that may not belong to a registered account.
// Used for team invitations to people without an account.
func SendToIdentity(identityHash, subject, content string) {
	if !Available() {
		return
	}
	sendAll([]string{identityHash}, subject, content)
}
