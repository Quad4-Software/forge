// Copyright 2014 The Gogs Authors. All rights reserved.
// Copyright 2018 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package setting

import (
	"errors"
	"net/http"
	"time"

	"forgejo.org/models"
	"forgejo.org/models/auth"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/auth/password"
	"forgejo.org/modules/base"
	"forgejo.org/modules/log"
	"forgejo.org/modules/optional"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/web"
	auth_method "forgejo.org/services/auth/method"
	"forgejo.org/services/auth/source/db"
	"forgejo.org/services/context"
	"forgejo.org/services/forms"
	"forgejo.org/services/user"
)

const (
	tplSettingsAccount base.TplName = "user/settings/account"
)

// Account renders change user's password, user's email and user suicide page
func Account(ctx *context.Context) {
	ctx.Data["Title"] = ctx.Tr("settings.account")
	ctx.Data["PageIsSettingsAccount"] = true
	ctx.Data["Email"] = ctx.Doer.Email
	ctx.Data["EnableNotifyMail"] = setting.Service.EnableNotifyMail

	loadAccountData(ctx)

	ctx.HTML(http.StatusOK, tplSettingsAccount)
}

// AccountPost response for change user's password
func AccountPost(ctx *context.Context) {
	if user_model.IsFeatureDisabledWithLoginType(ctx.Doer, setting.UserFeatureManagePassword) {
		ctx.NotFound("Not Found", errors.New("password is not allowed to be changed"))
		return
	}

	form := web.GetForm(ctx).(*forms.ChangePasswordForm)
	ctx.Data["Title"] = ctx.Tr("settings")
	ctx.Data["PageIsSettingsAccount"] = true

	if ctx.HasError() {
		loadAccountData(ctx)

		ctx.HTML(http.StatusOK, tplSettingsAccount)
		return
	}

	if ctx.Doer.IsPasswordSet() && !ctx.Doer.ValidatePassword(ctx, form.OldPassword) {
		ctx.Flash.Error(ctx.Tr("settings.password_incorrect"))
	} else if form.Password != form.Retype {
		ctx.Flash.Error(ctx.Tr("form.password_not_match"))
	} else {
		opts := &user.UpdateAuthOptions{
			Password:           optional.Some(form.Password),
			MustChangePassword: optional.Some(false),
		}
		if err := user.UpdateAuth(ctx, ctx.Doer, opts); err != nil {
			switch {
			case errors.Is(err, password.ErrMinLength):
				ctx.Flash.Error(ctx.Tr("auth.password_too_short", setting.MinPasswordLength))
			case errors.Is(err, password.ErrComplexity):
				ctx.Flash.Error(password.BuildComplexityError(ctx.Locale))
			case errors.Is(err, password.ErrIsPwned):
				ctx.Flash.Error(ctx.Tr("auth.password_pwned", "https://haveibeenpwned.com/Passwords"))
			case password.IsErrIsPwnedRequest(err):
				ctx.Flash.Error(ctx.Tr("auth.password_pwned_err"))
			default:
				ctx.ServerError("UpdateAuth", err)
				return
			}
		} else {
			// Re-generate LTA cookie.
			if len(ctx.GetSiteCookie(setting.CookieRememberName)) != 0 {
				if err := ctx.SetLTACookie(ctx.Doer); err != nil {
					ctx.ServerError("SetLTACookie", err)
					return
				}
			}

			log.Trace("User password updated: %s", ctx.Doer.Name)
			ctx.Flash.Success(ctx.Tr("settings.change_password_success"))
		}
	}

	ctx.Redirect(setting.AppSubURL + "/user/settings/account")
}

// EmailNotificationPost updates the notification delivery preference.
func EmailNotificationPost(ctx *context.Context) {
	ctx.Data["Title"] = ctx.Tr("settings")
	ctx.Data["PageIsSettingsAccount"] = true

	preference := ctx.FormString("preference")
	if preference != user_model.EmailNotificationsEnabled &&
		preference != user_model.EmailNotificationsOnMention &&
		preference != user_model.EmailNotificationsDisabled &&
		preference != user_model.EmailNotificationsAndYourOwn {
		log.Error("Notifications preference change returned unrecognized option %s: %s", preference, ctx.Doer.Name)
		ctx.ServerError("SetNotificationPreference", errors.New("option unrecognized"))
		return
	}
	opts := &user.UpdateOptions{
		EmailNotificationsPreference: optional.Some(preference),
	}
	if err := user.UpdateUser(ctx, ctx.Doer, opts); err != nil {
		log.Error("Set notification preference failed: %v", err)
		ctx.ServerError("UpdateUser", err)
		return
	}
	ctx.Flash.Success(ctx.Tr("settings.email_preference_set_success"))
	ctx.Redirect(setting.AppSubURL + "/user/settings/account")
}

// DeleteAccount render user suicide page and response for delete user himself
func DeleteAccount(ctx *context.Context) {
	if user_model.IsFeatureDisabledWithLoginType(ctx.Doer, setting.UserFeatureDeletion) {
		ctx.Error(http.StatusNotFound)
		return
	}

	ctx.Data["Title"] = ctx.Tr("settings")
	ctx.Data["PageIsSettingsAccount"] = true

	if _, _, err := auth_method.UserSignIn(ctx, ctx.Doer.Name, ctx.FormString("password")); err != nil {
		switch {
		case user_model.IsErrUserNotExist(err):
			loadAccountData(ctx)

			ctx.RenderWithErr(ctx.Tr("form.user_not_exist"), tplSettingsAccount, nil)
		case errors.Is(err, auth.ErrUnsupportedLoginType):
			loadAccountData(ctx)

			ctx.RenderWithErr(ctx.Tr("form.unsupported_login_type"), tplSettingsAccount, nil)
		case errors.As(err, &db.ErrUserPasswordNotSet{}):
			loadAccountData(ctx)

			ctx.RenderWithErr(ctx.Tr("form.unset_password"), tplSettingsAccount, nil)
		case errors.As(err, &db.ErrUserPasswordInvalid{}):
			loadAccountData(ctx)

			ctx.RenderWithErr(ctx.Tr("form.enterred_invalid_password"), tplSettingsAccount, nil)
		default:
			ctx.ServerError("UserSignIn", err)
		}
		return
	}

	// admin should not delete themself
	if ctx.Doer.IsAdmin {
		ctx.Flash.Error(ctx.Tr("form.admin_cannot_delete_self"))
		ctx.Redirect(setting.AppSubURL + "/user/settings/account")
		return
	}

	if err := user.DeleteUser(ctx, ctx.Doer, false); err != nil {
		switch {
		case models.IsErrUserOwnRepos(err):
			ctx.Flash.Error(ctx.Tr("form.still_own_repo"))
			ctx.Redirect(setting.AppSubURL + "/user/settings/account")
		case models.IsErrUserHasOrgs(err):
			ctx.Flash.Error(ctx.Tr("form.still_has_org"))
			ctx.Redirect(setting.AppSubURL + "/user/settings/account")
		case models.IsErrUserOwnPackages(err):
			ctx.Flash.Error(ctx.Tr("form.still_own_packages"))
			ctx.Redirect(setting.AppSubURL + "/user/settings/account")
		case models.IsErrDeleteLastAdminUser(err):
			ctx.Flash.Error(ctx.Tr("auth.last_admin"))
			ctx.Redirect(setting.AppSubURL + "/user/settings/account")
		default:
			ctx.ServerError("DeleteUser", err)
		}
	} else {
		log.Trace("Account deleted: %s", ctx.Doer.Name)
		ctx.Redirect(setting.AppSubURL + "/")
	}
}

func loadAccountData(ctx *context.Context) {
	ctx.Data["EmailNotificationsPreference"] = ctx.Doer.EmailNotificationsPreference
	ctx.Data["UserDisabledFeatures"] = user_model.DisabledFeaturesWithLoginType(ctx.Doer)

	if setting.Service.UserDeleteWithCommentsMaxTime != 0 {
		ctx.Data["UserDeleteWithCommentsMaxTime"] = setting.Service.UserDeleteWithCommentsMaxTime.String()
		ctx.Data["UserDeleteWithComments"] = ctx.Doer.CreatedUnix.AsTime().Add(setting.Service.UserDeleteWithCommentsMaxTime).After(time.Now())
	}
}
