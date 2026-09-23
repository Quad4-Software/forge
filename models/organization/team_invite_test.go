// Copyright 2022 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package organization_test

import (
	"testing"
	"time"

	"forgejo.org/models/db"
	"forgejo.org/models/organization"
	"forgejo.org/models/unittest"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/optional"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/test"
	"forgejo.org/modules/timeutil"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTeamInvite(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())
	defer test.MockVariableValue(&setting.Service.TeamInvitationExpiryDays, 14)()

	team := unittest.AssertExistsAndLoadBean(t, &organization.Team{ID: 2})

	t.Run("IdentityExistsInTeam", func(t *testing.T) {
		user2 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 2})

		// an identity owned by user 2, who is already in team 2, must error
		const memberHash = "99b75fdb14a0666c1cc5b2fa48502f5b"
		_, err := user_model.AddRNSKey(db.DefaultContext, user2, "member", memberHash, true)
		require.NoError(t, err)
		_, err = organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user2, team, memberHash)
		require.Error(t, err)
	})

	t.Run("UserExistsInTeam", func(t *testing.T) {
		user2 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 2})
		user4 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 2})

		// user 4 already added to team 2, should result in error
		_, err := organization.CreateTeamInviteForUser(db.DefaultContext, user2, user4, team)
		require.Error(t, err)
		invited, err := organization.IsInvitedToOrganization(db.DefaultContext, team.OrgID, user4.ID)
		require.NoError(t, err)
		require.False(t, invited)
	})

	t.Run("CreateAndRemoveByUser", func(t *testing.T) {
		user1 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})
		user5 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 5})

		invite, err := organization.CreateTeamInviteForUser(db.DefaultContext, user1, user5, team)
		assert.NotNil(t, invite)
		require.NoError(t, err)
		hasExpiration, expirationDate := invite.ExpiryUnix.Get()
		assert.True(t, hasExpiration)
		assert.Greater(t, expirationDate, timeutil.TimeStampNow().AddDuration(13*24*time.Hour))
		assert.Less(t, expirationDate, timeutil.TimeStampNow().AddDuration(15*24*time.Hour))
		invited, err := organization.IsInvitedToOrganization(db.DefaultContext, team.OrgID, user5.ID)
		require.NoError(t, err)
		require.True(t, invited)

		// Shouldn't allow duplicate invite through the identity of the
		// already invited user
		const user5Hash = "3016048118ab6ff9dc6e5a4608317923"
		_, err = user_model.AddRNSKey(db.DefaultContext, user5, "main", user5Hash, true)
		require.NoError(t, err)
		_, err = organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, user5Hash)
		require.Error(t, err)
		// Shouldn't allow duplicate invite by user
		_, err = organization.CreateTeamInviteForUser(db.DefaultContext, user1, user5, team)
		require.Error(t, err)

		// Check that the invite is visible through various getters
		singleInvite, err := organization.GetInviteByOrgAndUser(db.DefaultContext, team.OrgID, user5.ID)
		require.NoError(t, err)
		assert.Equal(t, invite.ID, singleInvite.ID)
		teams, err := organization.GetTeamsInvitedTo(db.DefaultContext, team.OrgID, user5.ID)
		require.NoError(t, err)
		assert.Len(t, teams, 1)
		assert.Equal(t, team, teams[0])

		// should remove invite
		require.NoError(t, organization.RemoveInviteByID(db.DefaultContext, invite.ID, invite.TeamID))

		// invite should not exist
		_, err = organization.GetInviteByToken(db.DefaultContext, invite.Token)
		require.Error(t, err)
	})

	t.Run("CreateByIdentityAndRemove", func(t *testing.T) {
		user1 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})

		invite, err := organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, "5f4dcf48d69bd8de494f0b04dd1d55ec")
		assert.NotNil(t, invite)
		require.NoError(t, err)
		hasExpiration, expirationDate := invite.ExpiryUnix.Get()
		assert.True(t, hasExpiration)
		assert.Greater(t, expirationDate, timeutil.TimeStampNow().AddDuration(13*24*time.Hour))
		assert.Less(t, expirationDate, timeutil.TimeStampNow().AddDuration(15*24*time.Hour))

		// Shouldn't allow duplicate invite
		_, err = organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, "5f4dcf48d69bd8de494f0b04dd1d55ec")
		require.Error(t, err)

		// should remove invite
		require.NoError(t, organization.RemoveInviteByID(db.DefaultContext, invite.ID, invite.TeamID))

		// invite should not exist
		_, err = organization.GetInviteByToken(db.DefaultContext, invite.Token)
		require.Error(t, err)
	})

	t.Run("CreateByUserWithoutExpiration", func(t *testing.T) {
		defer test.MockVariableValue(&setting.Service.TeamInvitationExpiryDays, 0)()
		user1 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})
		user5 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 5})

		invite, err := organization.CreateTeamInviteForUser(db.DefaultContext, user1, user5, team)
		require.NoError(t, err)
		assert.NotNil(t, invite)
		assert.False(t, invite.ExpiryUnix.Has())

		// Shouldn't allow duplicate invite through the identity of the
		// already invited user
		_, err = organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, "3016048118ab6ff9dc6e5a4608317923")
		require.Error(t, err)
		// Shouldn't allow duplicate invite by user
		_, err = organization.CreateTeamInviteForUser(db.DefaultContext, user1, user5, team)
		require.Error(t, err)
	})

	t.Run("CreateByIdentityWithoutExpiration", func(t *testing.T) {
		defer test.MockVariableValue(&setting.Service.TeamInvitationExpiryDays, 0)()
		user1 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})

		invite, err := organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, "5f4dcf48d69bd8de494f0b04dd1d55ec")
		assert.NotNil(t, invite)
		require.NoError(t, err)
		assert.False(t, invite.ExpiryUnix.Has())

		// Shouldn't allow duplicate invite
		_, err = organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, "5f4dcf48d69bd8de494f0b04dd1d55ec")
		require.Error(t, err)
	})

	t.Run("RecreateByUserAfterExpiration", func(t *testing.T) {
		user1 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})
		user12 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 12})

		invite, err := organization.CreateTeamInviteForUser(db.DefaultContext, user1, user12, team)
		assert.NotNil(t, invite)
		require.NoError(t, err)
		// manually make the invite expire
		_, err = db.GetEngine(t.Context()).Table("team_invite").Cols("expiry_unix").Update(
			&organization.TeamInvite{ExpiryUnix: optional.Some(timeutil.TimeStamp(int64(timeutil.TimeStampNow()) - 500))},
		)
		require.NoError(t, err)

		// The user is not considered invited anymore
		invited, err := organization.IsInvitedToOrganization(db.DefaultContext, team.OrgID, user12.ID)
		require.NoError(t, err)
		require.False(t, invited)

		// Creating the invite again succeeds
		newInvite, err := organization.CreateTeamInviteForUser(db.DefaultContext, user1, user12, team)
		require.NoError(t, err)
		assert.Equal(t, newInvite.InvitedUser, user12)
		assert.False(t, newInvite.IsExpired())

		// The previous invite is deleted
		oldInviteExists, err := db.GetEngine(t.Context()).Exist(&organization.TeamInvite{ID: invite.ID})
		require.NoError(t, err)
		assert.False(t, oldInviteExists)
	})

	t.Run("RecreateByIdentityAfterExpiration", func(t *testing.T) {
		user1 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})

		invite, err := organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, "1753bdb368271a785887ddbfb926164f")
		assert.NotNil(t, invite)
		require.NoError(t, err)
		// manually make the invite expire
		_, err = db.GetEngine(t.Context()).Table("team_invite").Cols("expiry_unix").Update(
			&organization.TeamInvite{ExpiryUnix: optional.Some(timeutil.TimeStamp(int64(timeutil.TimeStampNow()) - 500))},
		)
		require.NoError(t, err)

		// Creating the invite again succeeds
		newInvite, err := organization.CreateTeamInviteByRNSIdentity(db.DefaultContext, user1, team, "1753bdb368271a785887ddbfb926164f")
		require.NoError(t, err)
		assert.Equal(t, "rns:1753bdb368271a785887ddbfb926164f", newInvite.Email)
		assert.False(t, newInvite.IsExpired())

		// The previous invite is deleted
		oldInviteExists, err := db.GetEngine(t.Context()).Exist(&organization.TeamInvite{ID: invite.ID})
		require.NoError(t, err)
		assert.False(t, oldInviteExists)
	})
}
