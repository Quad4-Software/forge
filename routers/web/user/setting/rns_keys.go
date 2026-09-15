// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package setting

import (
	"net/http"
	"strings"

	auth_model "forgejo.org/models/auth"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/base"
	"forgejo.org/modules/rns"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/web"
	"forgejo.org/services/context"
	"forgejo.org/services/forms"
)

const (
	tplSettingsRNSKeys base.TplName = "user/settings/rns_keys"
)

// RNSKeys render user's Reticulum identities page
func RNSKeys(ctx *context.Context) {
	if !setting.RNS.Enabled {
		ctx.NotFound("NotFound", nil)
		return
	}
	ctx.Data["Title"] = ctx.Tr("settings.rns_keys")
	ctx.Data["PageIsSettingsRNSKeys"] = true
	ctx.Data["EnableLXMF"] = setting.RNS.EnableLXMF
	ctx.Data["IdentityHash"] = rns.IdentityHash()
	ctx.Data["GitDestination"] = rns.GitDestinationHash()

	loadRNSKeysData(ctx)

	ctx.HTML(http.StatusOK, tplSettingsRNSKeys)
}

func loadRNSKeysData(ctx *context.Context) {
	keys, err := user_model.GetRNSKeysByUserID(ctx, ctx.Doer.ID)
	if err != nil {
		ctx.ServerError("GetRNSKeysByUserID", err)
		return
	}
	ctx.Data["RNSKeys"] = keys
}

// RNSKeysPost registers a new Reticulum identity for the signed in user. The
// identity starts unverified. When LXMF is enabled a verification code is
// delivered to the lxmf.delivery destination of the identity.
func RNSKeysPost(ctx *context.Context) {
	if !setting.RNS.Enabled {
		ctx.NotFound("NotFound", nil)
		return
	}
	form := web.GetForm(ctx).(*forms.AddRNSKeyForm)
	ctx.Data["Title"] = ctx.Tr("settings.rns_keys")
	ctx.Data["PageIsSettingsRNSKeys"] = true
	ctx.Data["EnableLXMF"] = setting.RNS.EnableLXMF
	ctx.Data["IdentityHash"] = rns.IdentityHash()
	ctx.Data["GitDestination"] = rns.GitDestinationHash()

	if ctx.HasError() {
		loadRNSKeysData(ctx)
		ctx.HTML(http.StatusOK, tplSettingsRNSKeys)
		return
	}

	identityHash, err := user_model.NormalizeRNSIdentityHash(form.IdentityHash)
	if err != nil {
		loadRNSKeysData(ctx)
		ctx.Data["Err_IdentityHash"] = true
		ctx.RenderWithErr(ctx.Tr("settings.rns_invalid_identity_hash"), tplSettingsRNSKeys, &form)
		return
	}

	// Verified immediately when LXMF verification is unavailable. With LXMF the
	// key stays unverified until the delivered code is entered.
	key, err := user_model.AddRNSKey(ctx, ctx.Doer, form.Title, identityHash, !setting.RNS.EnableLXMF)
	if err != nil {
		if user_model.IsErrRNSKeyAlreadyUsed(err) {
			loadRNSKeysData(ctx)
			ctx.Data["Err_IdentityHash"] = true
			ctx.RenderWithErr(ctx.Tr("settings.rns_identity_been_used"), tplSettingsRNSKeys, &form)
			return
		}
		ctx.ServerError("AddRNSKey", err)
		return
	}

	if !key.Verified {
		if err := sendRNSKeyVerificationCode(ctx, key); err != nil {
			ctx.Flash.Error(ctx.Tr("settings.rns_verification_send_failed", err))
		} else {
			ctx.Flash.Info(ctx.Tr("settings.rns_verification_sent"))
		}
	} else {
		ctx.Flash.Success(ctx.Tr("settings.add_key_success", form.Title))
	}
	ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
}

// RNSKeysVerifyPost verifies a Reticulum identity with the code delivered over
// LXMF.
func RNSKeysVerifyPost(ctx *context.Context) {
	if !setting.RNS.Enabled || !setting.RNS.EnableLXMF {
		ctx.NotFound("NotFound", nil)
		return
	}
	form := web.GetForm(ctx).(*forms.VerifyRNSKeyForm)
	if ctx.HasError() {
		ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
		return
	}

	key := findOwnRNSKey(ctx, form.KeyID)
	if key == nil {
		ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
		return
	}
	if key.Verified {
		ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
		return
	}

	_, _, deleteToken, err := user_model.VerifyUserAuthorizationToken(ctx, strings.TrimSpace(form.Code), auth_model.RNSKeyVerification(key.ID))
	if err != nil {
		ctx.ServerError("VerifyUserAuthorizationToken", err)
		return
	}
	if deleteToken == nil {
		ctx.Flash.Error(ctx.Tr("settings.rns_invalid_verification_code"))
		ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
		return
	}
	if err := deleteToken(); err != nil {
		ctx.ServerError("DeleteAuthToken", err)
		return
	}
	if err := user_model.VerifyRNSKey(ctx, key); err != nil {
		ctx.ServerError("VerifyRNSKey", err)
		return
	}
	ctx.Flash.Success(ctx.Tr("settings.rns_key_verified", key.Name))
	ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
}

// RNSKeyDelete removes a Reticulum identity from the account.
func RNSKeyDelete(ctx *context.Context) {
	if !setting.RNS.Enabled {
		ctx.NotFound("NotFound", nil)
		return
	}
	if err := user_model.DeleteRNSKey(ctx, ctx.Doer.ID, ctx.FormInt64("id")); err != nil {
		ctx.ServerError("DeleteRNSKey", err)
		return
	}
	ctx.Flash.Success(ctx.Tr("settings.rns_key_deletion_success"))
	ctx.JSONRedirect(setting.AppSubURL + "/user/settings/rns_keys")
}

func findOwnRNSKey(ctx *context.Context, keyID int64) *user_model.RNSKey {
	keys, err := user_model.GetRNSKeysByUserID(ctx, ctx.Doer.ID)
	if err != nil {
		return nil
	}
	for _, k := range keys {
		if k.ID == keyID {
			return k
		}
	}
	return nil
}

// sendRNSKeyVerificationCode generates a verification code and delivers it to
// the lxmf.delivery destination of the registered identity.
func sendRNSKeyVerificationCode(ctx *context.Context, key *user_model.RNSKey) error {
	code, err := ctx.Doer.GenerateEmailAuthorizationCode(ctx, auth_model.RNSKeyVerification(key.ID))
	if err != nil {
		return err
	}
	content := ctx.Locale.TrString("settings.rns_verification_message", code, setting.AppName, key.Name)
	return rns.SendLXMFText(key.IdentityHash, ctx.Locale.TrString("settings.rns_verification_subject", setting.AppName), content)
}

// ResendRNSKeyVerification regenerates and resends the verification code for
// an unverified identity.
func ResendRNSKeyVerification(ctx *context.Context) {
	if !setting.RNS.Enabled || !setting.RNS.EnableLXMF {
		ctx.NotFound("NotFound", nil)
		return
	}
	key := findOwnRNSKey(ctx, ctx.FormInt64("id"))
	if key == nil || key.Verified {
		ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
		return
	}
	if err := sendRNSKeyVerificationCode(ctx, key); err != nil {
		ctx.Flash.Error(ctx.Tr("settings.rns_verification_send_failed", err))
	} else {
		ctx.Flash.Info(ctx.Tr("settings.rns_verification_sent"))
	}
	ctx.Redirect(setting.AppSubURL + "/user/settings/rns_keys")
}
