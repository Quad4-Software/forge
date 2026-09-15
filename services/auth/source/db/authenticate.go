// Copyright 2021 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package db

import (
	"context"
	"fmt"
	"sync"

	user_model "forgejo.org/models/user"
	"forgejo.org/modules/auth/password/hash"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/util"
)

// ErrUserPasswordNotSet represents a "ErrUserPasswordNotSet" kind of error.
type ErrUserPasswordNotSet struct {
	UID  int64
	Name string
}

func (err ErrUserPasswordNotSet) Error() string {
	return fmt.Sprintf("user's password isn't set [uid: %d, name: %s]", err.UID, err.Name)
}

// Unwrap unwraps this error as a ErrInvalidArgument error
func (err ErrUserPasswordNotSet) Unwrap() error {
	return util.ErrInvalidArgument
}

// ErrUserPasswordInvalid represents a "ErrUserPasswordInvalid" kind of error.
type ErrUserPasswordInvalid struct {
	UID  int64
	Name string
}

func (err ErrUserPasswordInvalid) Error() string {
	return fmt.Sprintf("user's password is invalid [uid: %d, name: %s]", err.UID, err.Name)
}

// Unwrap unwraps this error as a ErrInvalidArgument error
func (err ErrUserPasswordInvalid) Unwrap() error {
	return util.ErrInvalidArgument
}

var (
	dummyPasswordHashOnce sync.Once
	dummyPasswordHashAlgo *hash.PasswordHashAlgorithm
	dummyPasswordHash     string
	dummyPasswordSalt     string
)

// VerifyPasswordAgainstDummyHash runs a full password verification against a
// synthetic hash so that authentication attempts for nonexistent users take
// the same amount of time as for existing users. Otherwise the difference
// between the early return and the KDF computation is a reliable user
// enumeration oracle.
func VerifyPasswordAgainstDummyHash(password string) {
	dummyPasswordHashOnce.Do(func() {
		algo := hash.Parse(setting.PasswordHashAlgo)
		if algo == nil {
			return
		}
		dummyPasswordSalt = user_model.GetUserSalt()
		if h, err := algo.Hash("dummy-password", dummyPasswordSalt); err == nil {
			dummyPasswordHashAlgo = algo
			dummyPasswordHash = h
		}
	})
	if dummyPasswordHashAlgo != nil {
		dummyPasswordHashAlgo.VerifyPassword(password, dummyPasswordHash, dummyPasswordSalt)
	}
}

// Authenticate authenticates the provided user against the DB
func Authenticate(ctx context.Context, user *user_model.User, login, password string) (*user_model.User, error) {
	if user == nil {
		VerifyPasswordAgainstDummyHash(password)
		return nil, user_model.ErrUserNotExist{Name: login}
	}

	if !user.IsPasswordSet() {
		VerifyPasswordAgainstDummyHash(password)
		return nil, ErrUserPasswordNotSet{UID: user.ID, Name: user.Name}
	} else if !user.ValidatePassword(ctx, password) {
		return nil, ErrUserPasswordInvalid{UID: user.ID, Name: user.Name}
	}

	// Update password hash if server password hash algorithm have changed
	// Or update the password when the salt length doesn't match the current
	// recommended salt length, this in order to migrate user's salts to a more secure salt.
	if user.PasswdHashAlgo != setting.PasswordHashAlgo || len(user.Salt) != user_model.SaltByteLength*2 {
		if err := user.SetPassword(password); err != nil {
			return nil, err
		}
		if err := user_model.UpdateUserCols(ctx, user, "passwd", "passwd_hash_algo", "salt"); err != nil {
			return nil, err
		}
	}

	// WARN: DON'T check user.IsActive, that will be checked on reqSign so that
	// user could be hinted to resend confirm email.
	if user.ProhibitLogin {
		return nil, user_model.ErrUserProhibitLogin{
			UID:  user.ID,
			Name: user.Name,
		}
	}

	// attempting to login as a non-user account
	if user.Type != user_model.UserTypeIndividual {
		return nil, user_model.ErrUserProhibitLogin{
			UID:  user.ID,
			Name: user.Name,
		}
	}

	return user, nil
}
