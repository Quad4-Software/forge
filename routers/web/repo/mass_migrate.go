// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package repo

import (
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"path"
	"strings"

	"forgejo.org/models/db"
	quota_model "forgejo.org/models/quota"
	repo_model "forgejo.org/models/repo"
	"forgejo.org/modules/base"
	"forgejo.org/modules/log"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/structs"
	"forgejo.org/modules/util"
	"forgejo.org/modules/web"
	"forgejo.org/services/context"
	"forgejo.org/services/forms"
	"forgejo.org/services/migrations"
	migrations_allowlist "forgejo.org/services/migrations/allowlist"
	"forgejo.org/services/task"
)

const (
	tplMassMigrate       base.TplName = "repo/migrate/mass"
	tplMassMigrateSelect base.TplName = "repo/migrate/mass_select"
	tplMassMigrateResult base.TplName = "repo/migrate/mass_result"
)

func massMigrateDisabled(ctx *context.Context) bool {
	if setting.Repository.DisableMigrations {
		ctx.Error(http.StatusForbidden, "MassMigrate: the site administrator has disabled migrations")
		return true
	}
	return false
}

func massMigrateSupportedServices() []structs.GitServiceType {
	services := make([]structs.GitServiceType, 0, len(structs.SupportedFullGitService))
	for _, service := range structs.SupportedFullGitService {
		if migrations.MassListSupportedService(service) {
			services = append(services, service)
		}
	}
	return services
}

func setMassMigrateContextData(ctx *context.Context, form *forms.MassMigrateRepoForm) {
	ctx.Data["Title"] = ctx.Tr("repo.migrate.mass_title")
	ctx.Data["LFSActive"] = setting.LFS.StartServer
	ctx.Data["IsForcedPrivate"] = setting.Repository.ForcePrivate
	ctx.Data["DisableNewPullMirrors"] = setting.Mirror.DisableNewPull
	ctx.Data["Services"] = massMigrateSupportedServices()

	ctx.Data["service"] = form.Service
	ctx.Data["base_url"] = form.BaseURL
	ctx.Data["owner"] = form.Owner
	ctx.Data["owner_type"] = form.OwnerType
	ctx.Data["auth_token"] = form.AuthToken
	ctx.Data["uid"] = form.UID
	ctx.Data["private"] = form.Private
	ctx.Data["mirror"] = form.Mirror
	ctx.Data["lfs"] = form.LFS
	ctx.Data["wiki"] = form.Wiki
	ctx.Data["milestones"] = form.Milestones
	ctx.Data["labels"] = form.Labels
	ctx.Data["issues"] = form.Issues
	ctx.Data["pull_requests"] = form.PullRequests
	ctx.Data["releases"] = form.Releases
	ctx.Data["include_forks"] = form.IncludeForks
	ctx.Data["include_archived"] = form.IncludeArchived
	ctx.Data["include_private"] = form.IncludePrivate
}

// MassMigrate renders the mass migration configuration page
func MassMigrate(ctx *context.Context) {
	if massMigrateDisabled(ctx) {
		return
	}

	form := &forms.MassMigrateRepoForm{
		Service:   structs.GithubService,
		OwnerType: string(migrations.MassOwnerAuto),
		UID:       ctx.FormInt64("org"),
	}
	ctxUser := checkContextUser(ctx, form.UID)
	if ctx.Written() {
		return
	}
	ctx.Data["ContextUser"] = ctxUser
	setMassMigrateContextData(ctx, form)

	ctx.HTML(http.StatusOK, tplMassMigrate)
}

// MassMigratePost lists the remote repositories that can be mass migrated
func MassMigratePost(ctx *context.Context) {
	form := web.GetForm(ctx).(*forms.MassMigrateRepoForm)
	if massMigrateDisabled(ctx) {
		return
	}
	if form.Mirror && setting.Mirror.DisableNewPull {
		ctx.Error(http.StatusBadRequest, "MassMigratePost: the site administrator has disabled creation of new mirrors")
		return
	}

	ctxUser := checkContextUser(ctx, form.UID)
	if ctx.Written() {
		return
	}
	ctx.Data["ContextUser"] = ctxUser
	setMassMigrateContextData(ctx, form)

	if !ctx.CheckQuota(quota_model.LimitSubjectSizeReposAll, ctxUser.ID, ctxUser.Name) {
		return
	}

	if ctx.HasError() {
		ctx.HTML(http.StatusOK, tplMassMigrate)
		return
	}

	if !migrations.MassListSupportedService(form.Service) {
		ctx.RenderWithErr(ctx.Tr("repo.migrate.mass_service_not_supported"), tplMassMigrate, form)
		return
	}

	baseURL := strings.TrimSpace(form.BaseURL)
	if baseURL == "" && form.Service == structs.GithubService {
		baseURL = "https://github.com"
	}
	if baseURL == "" {
		ctx.Data["Err_BaseURL"] = true
		ctx.RenderWithErr(ctx.Tr("repo.migrate.mass_base_url_required"), tplMassMigrate, form)
		return
	}
	if !strings.HasPrefix(baseURL, "https://") && !(strings.HasPrefix(baseURL, "http://") && setting.Migrations.AllowUnencrypted) {
		ctx.Data["Err_BaseURL"] = true
		ctx.RenderWithErr(ctx.Tr("repo.migrate.mass_base_url_scheme"), tplMassMigrate, form)
		return
	}
	if err := migrations_allowlist.IsMigrateURLAllowed(baseURL, ctx.Doer); err != nil {
		ctx.Data["Err_BaseURL"] = true
		handleMigrateRemoteAddrError(ctx, err, tplMassMigrate, nil)
		return
	}

	repos, err := migrations.ListRemoteRepositories(ctx, form.Service, baseURL, form.Owner, form.AuthToken, migrations.MassListOptions{
		OwnerType:       migrations.MassOwnerType(form.OwnerType),
		IncludeForks:    form.IncludeForks,
		IncludeArchived: form.IncludeArchived,
		IncludePrivate:  form.IncludePrivate,
	})
	if err != nil {
		err = util.SanitizeErrorCredentialURLs(err)
		if migrations.IsRateLimitError(err) {
			ctx.RenderWithErr(ctx.Tr("form.visit_rate_limit"), tplMassMigrate, form)
		} else if migrations.IsTwoFactorAuthError(err) {
			ctx.RenderWithErr(ctx.Tr("form.2fa_auth_required"), tplMassMigrate, form)
		} else {
			ctx.Data["Err_Owner"] = true
			ctx.RenderWithErr(ctx.Tr("repo.migrate.mass_list_failed", err.Error()), tplMassMigrate, form)
		}
		return
	}
	if len(repos) == 0 {
		ctx.RenderWithErr(ctx.Tr("repo.migrate.mass_no_repos"), tplMassMigrate, form)
		return
	}

	// annotate repositories that already exist for the target owner so they can
	// be skipped instead of failing
	type selectableRepo struct {
		migrations.RemoteRepo
		Exists bool
	}
	selectable := make([]selectableRepo, 0, len(repos))
	for _, r := range repos {
		exists, err := repo_model.IsRepositoryModelExist(ctx, ctxUser, r.Name)
		if err != nil {
			log.Error("IsRepositoryModelExist: %v", err)
		}
		selectable = append(selectable, selectableRepo{RemoteRepo: r, Exists: exists})
	}

	ctx.Data["Repos"] = selectable
	ctx.Data["RepoCount"] = len(selectable)
	ctx.HTML(http.StatusOK, tplMassMigrateSelect)
}

// massMigrateResultItem is the per-repository outcome of a mass migration
type massMigrateResultItem struct {
	Name  string
	Link  string
	Error template.HTML
}

// repoNameFromCloneAddr derives a repository name from a remote clone address
func repoNameFromCloneAddr(cloneAddr string) string {
	u, err := url.Parse(cloneAddr)
	if err != nil {
		return ""
	}
	return strings.TrimSuffix(path.Base(strings.TrimSuffix(u.Path, "/")), ".git")
}

// MassMigrateConfirmPost queues migration tasks for the selected repositories
func MassMigrateConfirmPost(ctx *context.Context) {
	if massMigrateDisabled(ctx) {
		return
	}
	if err := ctx.Req.ParseForm(); err != nil {
		ctx.ServerError("ParseForm", err)
		return
	}

	service := structs.GitServiceType(ctx.FormInt("service"))
	mirror := ctx.FormBool("mirror")
	if mirror && setting.Mirror.DisableNewPull {
		ctx.Error(http.StatusBadRequest, "MassMigrateConfirmPost: the site administrator has disabled creation of new mirrors")
		return
	}
	authToken := ctx.FormString("auth_token")

	ctxUser := checkContextUser(ctx, ctx.FormInt64("uid"))
	if ctx.Written() {
		return
	}
	ctx.Data["ContextUser"] = ctxUser
	ctx.Data["Title"] = ctx.Tr("repo.migrate.mass_title")

	if !ctx.CheckQuota(quota_model.LimitSubjectSizeReposAll, ctxUser.ID, ctxUser.Name) {
		return
	}

	cloneAddrs := ctx.Req.PostForm["clone_addr"]
	if len(cloneAddrs) == 0 {
		ctx.Flash.Error(ctx.Tr("repo.migrate.mass_nothing_selected"), true)
		ctx.Redirect(setting.AppSubURL + "/repo/migrate/mass")
		return
	}

	optsBase := migrations.MigrateOptions{
		GitServiceType: service,
		Private:        ctx.FormBool("private") || setting.Repository.ForcePrivate,
		Mirror:         mirror,
		LFS:            ctx.FormBool("lfs") && setting.LFS.StartServer,
		AuthToken:      authToken,
		Wiki:           ctx.FormBool("wiki"),
		Issues:         ctx.FormBool("issues"),
		Milestones:     ctx.FormBool("milestones"),
		Labels:         ctx.FormBool("labels"),
		PullRequests:   ctx.FormBool("pull_requests"),
		Releases:       ctx.FormBool("releases"),
	}
	optsBase.Comments = optsBase.Issues || optsBase.PullRequests
	if optsBase.Mirror {
		optsBase.Issues = false
		optsBase.Milestones = false
		optsBase.Labels = false
		optsBase.Comments = false
		optsBase.PullRequests = false
		optsBase.Releases = false
	}

	results := make([]massMigrateResultItem, 0, len(cloneAddrs))
	queued := 0
	for _, cloneAddr := range cloneAddrs {
		repoName := repoNameFromCloneAddr(cloneAddr)
		result := massMigrateResultItem{Name: repoName}
		if result.Name == "" {
			result.Name = cloneAddr
		}

		err := func() error {
			if result.Name == "" {
				return errors.New("invalid repository name")
			}
			remoteAddr, err := forms.ParseRemoteAddr(cloneAddr, "", "")
			if err != nil {
				return err
			}
			if err := migrations_allowlist.IsMigrateURLAllowed(remoteAddr, ctx.Doer); err != nil {
				return err
			}
			opts := optsBase
			opts.OriginalURL = cloneAddr
			opts.CloneAddr = remoteAddr
			opts.RepoName = repoName
			if err := repo_model.CheckCreateRepository(ctx, ctx.Doer, ctxUser, opts.RepoName); err != nil {
				return err
			}
			if err := task.MigrateRepository(ctx, ctx.Doer, ctxUser, opts); err != nil {
				return err
			}
			return nil
		}()

		if err != nil {
			result.Error = massMigrateErrorMessage(ctx, err)
		} else {
			result.Link = ctxUser.HomeLink() + "/" + url.PathEscape(repoName)
			queued++
		}
		results = append(results, result)
	}

	ctx.Data["Results"] = results
	ctx.Data["Queued"] = queued
	ctx.Data["Failed"] = len(results) - queued
	ctx.Flash.Success(ctx.Tr("repo.migrate.mass_started", queued, len(results)), true)
	ctx.HTML(http.StatusOK, tplMassMigrateResult)
}

// massMigrateErrorMessage converts an internal error into a sanitized,
// user-presentable message.
func massMigrateErrorMessage(ctx *context.Context, err error) template.HTML {
	err = util.SanitizeErrorCredentialURLs(err)
	switch {
	case repo_model.IsErrReachLimitOfRepo(err):
		maxCreationLimit := ctx.Doer.MaxCreationLimit()
		return ctx.TrN(maxCreationLimit, "repo.form.reach_limit_of_creation_1", "repo.form.reach_limit_of_creation_n", maxCreationLimit)
	case repo_model.IsErrRepoAlreadyExist(err):
		return ctx.Tr("form.repo_name_been_taken")
	case repo_model.IsErrRepoFilesAlreadyExist(err):
		return ctx.Tr("form.repository_files_already_exist")
	case db.IsErrNameReserved(err):
		return ctx.Tr("repo.form.name_reserved", err.(db.ErrNameReserved).Name)
	case db.IsErrNamePatternNotAllowed(err):
		return ctx.Tr("repo.form.name_pattern_not_allowed", err.(db.ErrNamePatternNotAllowed).Pattern)
	}
	return template.HTML(template.HTMLEscapeString(err.Error()))
}
