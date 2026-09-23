// Copyright 2017 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package user_test

import (
	"fmt"
	"testing"

	"forgejo.org/models/db"
	"forgejo.org/models/unittest"
	user_model "forgejo.org/models/user"
	"forgejo.org/modules/util"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetEmailAddresses(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	emails, _ := user_model.GetEmailAddresses(db.DefaultContext, int64(1))
	if assert.Len(t, emails, 3) {
		assert.True(t, emails[0].IsPrimary)
		assert.True(t, emails[2].IsActivated)
		assert.False(t, emails[2].IsPrimary)
	}

	emails, _ = user_model.GetEmailAddresses(db.DefaultContext, int64(2))
	if assert.Len(t, emails, 2) {
		assert.True(t, emails[0].IsPrimary)
		assert.True(t, emails[0].IsActivated)
	}
}

func TestIsEmailUsed(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	isExist, _ := user_model.IsEmailUsed(db.DefaultContext, "")
	assert.True(t, isExist)
	isExist, _ = user_model.IsEmailUsed(db.DefaultContext, "user11@example.com")
	assert.True(t, isExist)
	isExist, _ = user_model.IsEmailUsed(db.DefaultContext, "user1234567890@example.com")
	assert.False(t, isExist)
}

func TestGetActivatedEmailAddresses(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	testCases := []struct {
		UID      int64
		expected []*user_model.ActivatedEmailAddress
	}{
		{
			UID:      1,
			expected: []*user_model.ActivatedEmailAddress{{ID: 9, Email: "user1@example.com"}, {ID: 33, Email: "user1-2@example.com"}, {ID: 34, Email: "user1-3@example.com"}},
		},
		{
			UID:      2,
			expected: []*user_model.ActivatedEmailAddress{{ID: 3, Email: "user2@example.com"}},
		},
		{
			UID:      4,
			expected: []*user_model.ActivatedEmailAddress{{ID: 11, Email: "user4@example.com"}},
		},
		{
			UID:      11,
			expected: []*user_model.ActivatedEmailAddress{},
		},
	}

	for _, testCase := range testCases {
		t.Run(fmt.Sprintf("User %d", testCase.UID), func(t *testing.T) {
			emails, err := user_model.GetActivatedEmailAddresses(db.DefaultContext, testCase.UID)
			require.NoError(t, err)
			assert.Equal(t, testCase.expected, emails)
		})
	}
}

func TestDeletePrimaryEmailAddressOfUser(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	user, err := user_model.GetUserByName(db.DefaultContext, "org3")
	require.NoError(t, err)
	assert.Equal(t, "org3@example.com", user.Email)

	require.NoError(t, user_model.DeletePrimaryEmailAddressOfUser(db.DefaultContext, user.ID))

	user, err = user_model.GetUserByName(db.DefaultContext, "org3")
	require.NoError(t, err)
	assert.Empty(t, user.Email)

	email, err := user_model.GetPrimaryEmailAddressOfUser(db.DefaultContext, user.ID)
	require.ErrorIs(t, err, util.ErrNotExist)
	assert.Nil(t, email)
}

func TestActivateUserEmail(t *testing.T) {
	defer unittest.OverrideFixtures("models/fixtures/TestActivateUserEmail")()
	require.NoError(t, unittest.PrepareTestDatabase())

	t.Run("Activate email", func(t *testing.T) {
		require.NoError(t, user_model.ActivateUserEmail(t.Context(), 1001, "AnotherTestUserWithUpperCaseEmail@otto.splvs.net", true))

		unittest.AssertExistsAndLoadBean(t, &user_model.EmailAddress{UID: 1001}, "is_activated = true")
	})

	t.Run("Deactivate email", func(t *testing.T) {
		require.NoError(t, user_model.ActivateUserEmail(t.Context(), 1001, "AnotherTestUserWithUpperCaseEmail@otto.splvs.net", false))

		unittest.AssertExistsAndLoadBean(t, &user_model.EmailAddress{UID: 1001}, "is_activated = false")
	})
}
