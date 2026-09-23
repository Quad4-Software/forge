// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package user

import (
	"context"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"forgejo.org/models/db"
	"forgejo.org/modules/timeutil"
	"forgejo.org/modules/util"
)

// RNSKey associates a Reticulum identity with a user account. The identity hash
// authenticates git access over the Reticulum network and also addresses the
// user for LXMF message delivery, since the LXMF delivery destination is
// derived from the same identity.
type RNSKey struct {
	ID           int64  `xorm:"pk autoincr"`
	OwnerID      int64  `xorm:"INDEX NOT NULL"`
	Name         string `xorm:"NOT NULL"`
	IdentityHash string `xorm:"UNIQUE VARCHAR(32) NOT NULL"`
	Verified     bool   `xorm:"NOT NULL DEFAULT false"`

	CreatedUnix timeutil.TimeStamp `xorm:"created"`
	UpdatedUnix timeutil.TimeStamp `xorm:"updated"`
}

func init() {
	db.RegisterModel(new(RNSKey))
}

var rnsIdentityHashPattern = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)

// NormalizeRNSIdentityHash validates and lowercases a 16 byte Reticulum
// identity hash in hex form.
func NormalizeRNSIdentityHash(hash string) (string, error) {
	hash = strings.TrimSpace(hash)
	if !rnsIdentityHashPattern.MatchString(hash) {
		return "", fmt.Errorf("invalid Reticulum identity hash")
	}
	return strings.ToLower(hash), nil
}

// ErrRNSKeyAlreadyUsed is returned when an identity hash is registered twice.
type ErrRNSKeyAlreadyUsed struct {
	IdentityHash string
}

// IsErrRNSKeyAlreadyUsed checks if an error is a ErrRNSKeyAlreadyUsed.
func IsErrRNSKeyAlreadyUsed(err error) bool {
	_, ok := err.(ErrRNSKeyAlreadyUsed)
	return ok
}

func (err ErrRNSKeyAlreadyUsed) Error() string {
	return fmt.Sprintf("Reticulum identity is already registered: %s", err.IdentityHash)
}

// Unwrap marks ErrRNSKeyAlreadyUsed as an util.ErrAlreadyExist.
func (err ErrRNSKeyAlreadyUsed) Unwrap() error {
	return util.ErrAlreadyExist
}

// ErrRNSKeyNotExist is returned when no key matches an identity hash.
type ErrRNSKeyNotExist struct {
	IdentityHash string
}

// IsErrRNSKeyNotExist checks if an error is a ErrRNSKeyNotExist.
func IsErrRNSKeyNotExist(err error) bool {
	_, ok := err.(ErrRNSKeyNotExist)
	return ok
}

func (err ErrRNSKeyNotExist) Error() string {
	return fmt.Sprintf("Reticulum identity is not registered: %s", err.IdentityHash)
}

// Unwrap marks ErrRNSKeyNotExist as an util.ErrNotExist.
func (err ErrRNSKeyNotExist) Unwrap() error {
	return util.ErrNotExist
}

// IsRNSIdentityHash reports whether the value looks like a Reticulum identity
// hash in hex form.
func IsRNSIdentityHash(value string) bool {
	return rnsIdentityHashPattern.MatchString(strings.TrimSpace(value))
}

// AddRNSKey registers a new Reticulum identity for a user.
func AddRNSKey(ctx context.Context, u *User, name, identityHash string, verified bool) (*RNSKey, error) {
	identityHash, err := NormalizeRNSIdentityHash(identityHash)
	if err != nil {
		return nil, err
	}

	ctx, committer, err := db.TxContext(ctx)
	if err != nil {
		return nil, err
	}
	defer committer.Close()

	if has, err := db.GetEngine(ctx).Where("identity_hash = ?", identityHash).Exist(new(RNSKey)); err != nil {
		return nil, err
	} else if has {
		return nil, ErrRNSKeyAlreadyUsed{IdentityHash: identityHash}
	}

	key := &RNSKey{
		OwnerID:      u.ID,
		Name:         name,
		IdentityHash: identityHash,
		Verified:     verified,
	}
	if _, err := db.GetEngine(ctx).Insert(key); err != nil {
		return nil, err
	}

	return key, committer.Commit()
}

// GetRNSKeyByIdentityHash returns the key registered for an identity hash.
func GetRNSKeyByIdentityHash(ctx context.Context, identityHash string) (*RNSKey, error) {
	identityHash, err := NormalizeRNSIdentityHash(identityHash)
	if err != nil {
		return nil, err
	}
	key := new(RNSKey)
	if has, err := db.GetEngine(ctx).Where("identity_hash = ?", identityHash).Get(key); err != nil {
		return nil, err
	} else if !has {
		return nil, ErrRNSKeyNotExist{IdentityHash: identityHash}
	}
	return key, nil
}

// GetRNSKeysByUserID lists all Reticulum identities of a user.
func GetRNSKeysByUserID(ctx context.Context, userID int64) ([]*RNSKey, error) {
	keys := make([]*RNSKey, 0)
	return keys, db.GetEngine(ctx).Where("owner_id = ?", userID).Find(&keys)
}

// GetUserByRNSIdentityHash resolves a verified Reticulum identity hash to its
// owning user. Unverified keys never authenticate.
func GetUserByRNSIdentityHash(ctx context.Context, identityHash string) (*User, error) {
	key, err := GetRNSKeyByIdentityHash(ctx, identityHash)
	if err != nil {
		return nil, err
	}
	if !key.Verified {
		return nil, ErrUserNotExist{UID: key.OwnerID}
	}
	return GetUserByID(ctx, key.OwnerID)
}

// DeleteRNSKey removes a Reticulum identity from a user account.
func DeleteRNSKey(ctx context.Context, userID, keyID int64) error {
	_, err := db.GetEngine(ctx).Where("id = ? AND owner_id = ?", keyID, userID).Delete(new(RNSKey))
	return err
}

// VerifyRNSKey marks a key as verified.
func VerifyRNSKey(ctx context.Context, key *RNSKey) error {
	key.Verified = true
	_, err := db.GetEngine(ctx).ID(key.ID).Cols("verified").Update(key)
	return err
}

// UpdateRNSKeyActivity records a use of the identity for git access.
func UpdateRNSKeyActivity(ctx context.Context, key *RNSKey) error {
	_, err := db.GetEngine(ctx).ID(key.ID).Cols("updated_unix").Update(key)
	return err
}

// DecodeRNSIdentityHash decodes a normalized identity hash into raw bytes.
func DecodeRNSIdentityHash(identityHash string) ([]byte, error) {
	return hex.DecodeString(identityHash)
}
