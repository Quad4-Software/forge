// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package user_test

import (
	"strings"
	"testing"

	"forgejo.org/models/db"
	"forgejo.org/models/unittest"
	user_model "forgejo.org/models/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeRNSIdentityHash(t *testing.T) {
	valid := "0123456789abcdef0123456789abcdef"

	norm, err := user_model.NormalizeRNSIdentityHash(strings.ToUpper(valid))
	require.NoError(t, err)
	assert.Equal(t, valid, norm)

	norm, err = user_model.NormalizeRNSIdentityHash("  " + valid + "\n")
	require.NoError(t, err)
	assert.Equal(t, valid, norm)

	for _, bad := range []string{"", "abc", valid + "ff", "zzzz56789abcdef0123456789abcdef"} {
		_, err := user_model.NormalizeRNSIdentityHash(bad)
		assert.Error(t, err, "input %q should fail", bad)
	}
}

func TestRNSKey(t *testing.T) {
	require.NoError(t, unittest.PrepareTestDatabase())

	user1 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 1})
	user2 := unittest.AssertExistsAndLoadBean(t, &user_model.User{ID: 2})
	hash := "11111111111111111111111111111111"
	hash2 := "22222222222222222222222222222222"

	key, err := user_model.AddRNSKey(db.DefaultContext, user1, "laptop", strings.ToUpper(hash), false)
	require.NoError(t, err)
	assert.False(t, key.Verified)
	assert.Equal(t, hash, key.IdentityHash)

	// Duplicate identity hashes are rejected.
	_, err = user_model.AddRNSKey(db.DefaultContext, user2, "other", hash, true)
	assert.True(t, user_model.IsErrRNSKeyAlreadyUsed(err))

	// Unverified keys do not resolve to a user.
	_, err = user_model.GetUserByRNSIdentityHash(db.DefaultContext, hash)
	assert.True(t, user_model.IsErrUserNotExist(err))

	require.NoError(t, user_model.VerifyRNSKey(db.DefaultContext, key))

	resolved, err := user_model.GetUserByRNSIdentityHash(db.DefaultContext, hash)
	require.NoError(t, err)
	assert.Equal(t, user1.ID, resolved.ID)

	hashMap, err := user_model.GetVerifiedRNSIdentityHashesByUserIDs(db.DefaultContext, []int64{user1.ID, user2.ID})
	require.NoError(t, err)
	assert.Equal(t, []string{hash}, hashMap[user1.ID])
	assert.Empty(t, hashMap[user2.ID])

	key2, err := user_model.AddRNSKey(db.DefaultContext, user1, "phone", hash2, true)
	require.NoError(t, err)
	assert.True(t, key2.Verified)

	keys, err := user_model.GetRNSKeysByUserID(db.DefaultContext, user1.ID)
	require.NoError(t, err)
	assert.Len(t, keys, 2)

	require.NoError(t, user_model.DeleteRNSKey(db.DefaultContext, user1.ID, key2.ID))
	_, err = user_model.GetRNSKeyByIdentityHash(db.DefaultContext, hash2)
	assert.True(t, user_model.IsErrRNSKeyNotExist(err))

	// Deleting another users key is a no-op.
	require.NoError(t, user_model.DeleteRNSKey(db.DefaultContext, user2.ID, key.ID))
	unittest.AssertExistsAndLoadBean(t, &user_model.RNSKey{ID: key.ID})
}
