// Copyright 2024 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package user

import (
	"testing"

	"forgejo.org/models/db"
	org_model "forgejo.org/models/organization"
	"forgejo.org/models/unittest"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/setting"

	"github.com/gobwas/glob"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdminAddOrSetPrimaryEmailAddress(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	user := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 27})

	emails, err := user_model.GetEmailAddresses(db.DefaultContext, user.ID)
	require.NoError(t, err)
	assert.Len(t, emails, 1)

	primary, err := user_model.GetPrimaryEmailAddressOfUser(db.DefaultContext, user.ID)
	require.NoError(t, err)
	assert.NotEqual(t, "new-primary@example.com", primary.Email)
	assert.Equal(t, user.Email, primary.Email)

	require.NoError(t, AdminAddOrSetPrimaryEmailAddress(db.DefaultContext, user, "new-primary@example.com"))

	primary, err = user_model.GetPrimaryEmailAddressOfUser(db.DefaultContext, user.ID)
	require.NoError(t, err)
	assert.Equal(t, "new-primary@example.com", primary.Email)
	assert.Equal(t, user.Email, primary.Email)

	emails, err = user_model.GetEmailAddresses(db.DefaultContext, user.ID)
	require.NoError(t, err)
	assert.Len(t, emails, 2)

	setting.Service.EmailDomainAllowList = []glob.Glob{glob.MustCompile("example.org")}
	defer func() {
		setting.Service.EmailDomainAllowList = []glob.Glob{}
	}()

	require.NoError(t, AdminAddOrSetPrimaryEmailAddress(db.DefaultContext, user, "new-primary2@example2.com"))

	primary, err = user_model.GetPrimaryEmailAddressOfUser(db.DefaultContext, user.ID)
	require.NoError(t, err)
	assert.Equal(t, "new-primary2@example2.com", primary.Email)
	assert.Equal(t, user.Email, primary.Email)

	require.NoError(t, AdminAddOrSetPrimaryEmailAddress(db.DefaultContext, user, "user27@example.com"))

	primary, err = user_model.GetPrimaryEmailAddressOfUser(db.DefaultContext, user.ID)
	require.NoError(t, err)
	assert.Equal(t, "user27@example.com", primary.Email)
	assert.Equal(t, user.Email, primary.Email)

	emails, err = user_model.GetEmailAddresses(db.DefaultContext, user.ID)
	require.NoError(t, err)
	assert.Len(t, emails, 3)
}

func TestReplacePrimaryEmailAddress(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	t.Run("User", func(t *testing.T) {
		user := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 13})

		emails, err := user_model.GetEmailAddresses(db.DefaultContext, user.ID)
		require.NoError(t, err)
		assert.Len(t, emails, 1)

		primary, err := user_model.GetPrimaryEmailAddressOfUser(db.DefaultContext, user.ID)
		require.NoError(t, err)
		assert.NotEqual(t, "primary-13@example.com", primary.Email)
		assert.Equal(t, user.Email, primary.Email)

		require.NoError(t, ReplacePrimaryEmailAddress(db.DefaultContext, user, "primary-13@example.com"))

		primary, err = user_model.GetPrimaryEmailAddressOfUser(db.DefaultContext, user.ID)
		require.NoError(t, err)
		assert.Equal(t, "primary-13@example.com", primary.Email)
		assert.Equal(t, user.Email, primary.Email)

		emails, err = user_model.GetEmailAddresses(db.DefaultContext, user.ID)
		require.NoError(t, err)
		assert.Len(t, emails, 1)

		require.NoError(t, ReplacePrimaryEmailAddress(db.DefaultContext, user, "primary-13@example.com"))
	})

	t.Run("Organization", func(t *testing.T) {
		org := unittest.AssertExistsAndLoadBean(t, &org_model.Organization{ID: 3})

		assert.Equal(t, "org3@example.com", org.Email)

		require.NoError(t, ReplacePrimaryEmailAddress(db.DefaultContext, org.AsUser(), "primary-org@example.com"))

		assert.Equal(t, "primary-org@example.com", org.Email)
	})
}
