// Copyright 2016 The Gogs Authors. All rights reserved.
// Copyright 2016 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package cmd

import (
	"context"
	"fmt"
	"time"

	"forgejo.org/models/db"
	repo_model "forgejo.org/models/repo"
	"forgejo.org/modules/git"
	"forgejo.org/modules/gitrepo"
	"forgejo.org/modules/log"
	repo_module "forgejo.org/modules/repository"
	"forgejo.org/modules/setting"
	"forgejo.org/routers/install"

	"github.com/urfave/cli/v3"
)

// CmdAdmin represents the available admin sub-command.
func cmdAdmin() *cli.Command {
	return &cli.Command{
		Name:  "admin",
		Usage: "Perform common administrative operations",
		Commands: []*cli.Command{
			subcmdUser(),
			subcmdRepoSyncReleases(),
			subcmdRegenerate(),
			subcmdAuth(),
			subcmdRegenerateSetupLink(),
		},
	}
}

func subcmdRegenerateSetupLink() *cli.Command {
	return &cli.Command{
		Name:   "regenerate-setup-link",
		Usage:  "Generate a new secure setup link (only while the instance is not installed)",
		Before: noDanglingArgs,
		Action: runRegenerateSetupLink,
	}
}

func runRegenerateSetupLink(_ context.Context, _ *cli.Command) error {
	setting.LoadCommonSettings()
	if setting.InstallLock {
		fmt.Println("This instance is already installed, no setup link is needed.")
		return nil
	}
	token, expiry, err := install.RegenerateSetupToken()
	if err != nil {
		return err
	}
	fmt.Printf("Secure setup link (expires %s):\n  %s\n", expiry.Format(time.RFC3339), install.SetupURL(token))
	return nil
}

func subcmdRepoSyncReleases() *cli.Command {
	return &cli.Command{
		Name:   "repo-sync-releases",
		Usage:  "Synchronize repository releases with tags",
		Before: noDanglingArgs,
		Action: runRepoSyncReleases,
	}
}

func subcmdRegenerate() *cli.Command {
	return &cli.Command{
		Name:  "regenerate",
		Usage: "Regenerate specific files",
		Commands: []*cli.Command{
			microcmdRegenKeys,
		},
	}
}

func subcmdAuth() *cli.Command {
	return &cli.Command{
		Name:  "auth",
		Usage: "Modify external auth providers",
		Commands: []*cli.Command{
			microcmdAuthAddOauth(),
			microcmdAuthUpdateOauth(),
			microcmdAuthAddLdapBindDn(),
			microcmdAuthUpdateLdapBindDn(),
			microcmdAuthAddLdapSimpleAuth(),
			microcmdAuthUpdateLdapSimpleAuth(),
			microcmdAuthAddPAM(),
			microcmdAuthUpdatePAM(),
			microcmdAuthList(),
			microcmdAuthDelete(),
		},
	}
}

func idFlag() *cli.Int64Flag {
	return &cli.Int64Flag{
		Name:  "id",
		Usage: "ID of authentication source",
	}
}

func runRepoSyncReleases(ctx context.Context, c *cli.Command) error {
	ctx, cancel := installSignals(ctx)
	defer cancel()

	if err := initDB(ctx); err != nil {
		return err
	}

	if err := git.InitSimple(ctx); err != nil {
		return err
	}

	log.Trace("Synchronizing repository releases (this may take a while)")
	for page := 1; ; page++ {
		repos, count, err := repo_model.SearchRepositoryByName(ctx, &repo_model.SearchRepoOptions{
			PageSize: repo_model.RepositoryListDefaultPageSize,
			Page:     page,
			Private:  true,
		})
		if err != nil {
			return fmt.Errorf("SearchRepositoryByName: %w", err)
		}
		if len(repos) == 0 {
			break
		}
		log.Trace("Processing next %d repos of %d", len(repos), count)
		for _, repo := range repos {
			log.Trace("Synchronizing repo %s with path %s", repo.FullName(), repo.RepoPath())
			gitRepo, err := gitrepo.OpenRepository(ctx, repo)
			if err != nil {
				log.Warn("OpenRepository: %v", err)
				continue
			}

			oldnum, err := getReleaseCount(ctx, repo.ID)
			if err != nil {
				log.Warn(" GetReleaseCountByRepoID: %v", err)
			}
			log.Trace(" currentNumReleases is %d, running SyncReleasesWithTags", oldnum)

			if err = repo_module.SyncReleasesWithTags(ctx, repo, gitRepo); err != nil {
				log.Warn(" SyncReleasesWithTags: %v", err)
				gitRepo.Close()
				continue
			}

			count, err = getReleaseCount(ctx, repo.ID)
			if err != nil {
				log.Warn(" GetReleaseCountByRepoID: %v", err)
				gitRepo.Close()
				continue
			}

			log.Trace(" repo %s releases synchronized to tags: from %d to %d",
				repo.FullName(), oldnum, count)
			gitRepo.Close()
		}
	}

	return nil
}

func getReleaseCount(ctx context.Context, id int64) (int64, error) {
	return db.Count[repo_model.Release](
		ctx,
		repo_model.FindReleasesOptions{
			RepoID:      id,
			IncludeTags: true,
		},
	)
}
