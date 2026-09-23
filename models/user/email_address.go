// Copyright 2016 The Gogs Authors. All rights reserved.
// Copyright 2020 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package user

import (
	"context"
	"fmt"
	"strings"

	"forgejo.org/models/db"
	"forgejo.org/modules/log"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/util"

	"xorm.io/builder"
)

// ErrEmailAlreadyUsed represents a "EmailAlreadyUsed" kind of error.
type ErrEmailAlreadyUsed struct {
	Email string
}

// IsErrEmailAlreadyUsed checks if an error is a ErrEmailAlreadyUsed.
func IsErrEmailAlreadyUsed(err error) bool {
	_, ok := err.(ErrEmailAlreadyUsed)
	return ok
}

func (err ErrEmailAlreadyUsed) Error() string {
	return fmt.Sprintf("e-mail already in use [email: %s]", err.Email)
}

func (err ErrEmailAlreadyUsed) Unwrap() error {
	return util.ErrAlreadyExist
}

// ErrEmailAddressNotExist email address not exist
type ErrEmailAddressNotExist struct {
	Email string
}

func (err ErrEmailAddressNotExist) Error() string {
	return fmt.Sprintf("Email address does not exist [email: %s]", err.Email)
}

func (err ErrEmailAddressNotExist) Unwrap() error {
	return util.ErrNotExist
}

// EmailAddress is the list of all email addresses of a user. It also contains the
// primary email address which is saved in user table.
type EmailAddress struct {
	ID          int64  `xorm:"pk autoincr"`
	UID         int64  `xorm:"INDEX NOT NULL"`
	Email       string `xorm:"UNIQUE NOT NULL"`
	LowerEmail  string `xorm:"UNIQUE NOT NULL"`
	IsActivated bool
	IsPrimary   bool `xorm:"DEFAULT(false) NOT NULL"`
}

func init() {
	db.RegisterModel(new(EmailAddress))
}

// BeforeInsert will be invoked by XORM before inserting a record
func (email *EmailAddress) BeforeInsert() {
	if email.LowerEmail == "" {
		email.LowerEmail = strings.ToLower(email.Email)
	}
}

func InsertEmailAddress(ctx context.Context, email *EmailAddress) (*EmailAddress, error) {
	if err := db.Insert(ctx, email); err != nil {
		return nil, err
	}
	return email, nil
}

func UpdateEmailAddress(ctx context.Context, email *EmailAddress) error {
	_, err := db.GetEngine(ctx).ID(email.ID).AllCols().Update(email)
	return err
}

func GetEmailAddressByEmail(ctx context.Context, email string) (*EmailAddress, error) {
	ea := &EmailAddress{}
	if has, err := db.GetEngine(ctx).Where("lower_email=?", strings.ToLower(email)).Get(ea); err != nil {
		return nil, err
	} else if !has {
		return nil, ErrEmailAddressNotExist{email}
	}
	return ea, nil
}

func GetPrimaryEmailAddressOfUser(ctx context.Context, uid int64) (*EmailAddress, error) {
	ea := &EmailAddress{}
	if has, err := db.GetEngine(ctx).Where("uid=? AND is_primary=?", uid, true).Get(ea); err != nil {
		return nil, err
	} else if !has {
		return nil, ErrEmailAddressNotExist{}
	}
	return ea, nil
}

// Deletes the primary email address of the user
// This is only allowed if the user is a organization
func DeletePrimaryEmailAddressOfUser(ctx context.Context, uid int64) error {
	user, err := GetUserByID(ctx, uid)
	if err != nil {
		return err
	}

	if user.Type != UserTypeOrganization {
		return fmt.Errorf("%s is not a organization", user.Name)
	}

	ctx, committer, err := db.TxContext(ctx)
	if err != nil {
		return err
	}
	defer committer.Close()

	_, err = db.GetEngine(ctx).Exec("DELETE FROM email_address WHERE uid = ? AND is_primary = true", uid)
	if err != nil {
		return err
	}

	user.Email = ""
	err = UpdateUserCols(ctx, user, "email")
	if err != nil {
		return err
	}

	return committer.Commit()
}

// GetEmailAddresses returns all email addresses belongs to given user.
func GetEmailAddresses(ctx context.Context, uid int64) ([]*EmailAddress, error) {
	emails := make([]*EmailAddress, 0, 5)
	if err := db.GetEngine(ctx).
		Where("uid=?", uid).
		Asc("id").
		Find(&emails); err != nil {
		return nil, err
	}
	return emails, nil
}

type ActivatedEmailAddress struct {
	ID    int64
	Email string
}

func GetActivatedEmailAddresses(ctx context.Context, uid int64) ([]*ActivatedEmailAddress, error) {
	emails := make([]*ActivatedEmailAddress, 0, 8)
	if err := db.GetEngine(ctx).
		Table("email_address").
		Select("id, email").
		Where("uid=?", uid).
		And("is_activated=?", true).
		Asc("id").
		Find(&emails); err != nil {
		return nil, err
	}
	return emails, nil
}

// GetEmailAddressByID gets a user's email address by ID
func GetEmailAddressByID(ctx context.Context, uid, id int64) (*EmailAddress, error) {
	// User ID is required for security reasons
	email := &EmailAddress{UID: uid}
	if has, err := db.GetEngine(ctx).ID(id).Get(email); err != nil {
		return nil, err
	} else if !has {
		return nil, nil
	}
	return email, nil
}

// IsEmailActive check if email is activated with a different emailID
func IsEmailActive(ctx context.Context, email string, excludeEmailID int64) (bool, error) {
	if len(email) == 0 {
		return true, nil
	}

	// Can't filter by boolean field unless it's explicit
	cond := builder.NewCond()
	cond = cond.And(builder.Eq{"lower_email": strings.ToLower(email)}, builder.Neq{"id": excludeEmailID})
	if setting.Service.RegisterEmailConfirm {
		// Inactive (unvalidated) addresses don't count as active if email validation is required
		cond = cond.And(builder.Eq{"is_activated": true})
	}

	var em EmailAddress
	if has, err := db.GetEngine(ctx).Where(cond).Get(&em); has || err != nil {
		if has {
			log.Info("isEmailActive(%q, %d) found duplicate in email ID %d", email, excludeEmailID, em.ID)
		}
		return has, err
	}

	return false, nil
}

// IsEmailUsed returns true if the email has been used.
func IsEmailUsed(ctx context.Context, email string) (bool, error) {
	if len(email) == 0 {
		return true, nil
	}

	return db.GetEngine(ctx).Where("lower_email=?", strings.ToLower(email)).Get(&EmailAddress{})
}

func updateActivation(ctx context.Context, email *EmailAddress, activate bool) error {
	user, err := GetUserByID(ctx, email.UID)
	if err != nil {
		return err
	}
	user.Rands = GetUserSalt()
	email.IsActivated = activate
	if _, err := db.GetEngine(ctx).ID(email.ID).Cols("is_activated").Update(email); err != nil {
		return err
	}
	return UpdateUserCols(ctx, user, "rands")
}

// ActivateUserEmail will change the activated state of an email address,
// either primary or secondary (all in the email_address table)
func ActivateUserEmail(ctx context.Context, userID int64, email string, activate bool) (err error) {
	ctx, committer, err := db.TxContext(ctx)
	if err != nil {
		return err
	}
	defer committer.Close()

	// Activate/deactivate a user's secondary email address
	// First check if there's another user active with the same address
	addr, exist, err := db.Get[EmailAddress](ctx, builder.Eq{"uid": userID, "lower_email": strings.ToLower(email)})
	if err != nil {
		return err
	} else if !exist {
		return fmt.Errorf("no such email: %d (%s)", userID, email)
	}

	if addr.IsActivated == activate {
		// Already in the desired state; no action
		return nil
	}
	if activate {
		if used, err := IsEmailActive(ctx, email, addr.ID); err != nil {
			return fmt.Errorf("unable to check isEmailActive() for %s: %w", email, err)
		} else if used {
			return ErrEmailAlreadyUsed{Email: email}
		}
	}
	if err = updateActivation(ctx, addr, activate); err != nil {
		return fmt.Errorf("unable to updateActivation() for %d:%s: %w", addr.ID, addr.Email, err)
	}

	// Activate/deactivate a user's primary email address and account
	if addr.IsPrimary {
		user, exist, err := db.Get[User](ctx, builder.Eq{"id": userID, "email": email})
		if err != nil {
			return err
		} else if !exist {
			return fmt.Errorf("no user with ID: %d and Email: %s", userID, email)
		}

		// The user's activation state should be synchronized with the primary email
		if user.IsActive != activate {
			user.IsActive = activate
			user.Rands = GetUserSalt()
			if err = UpdateUserCols(ctx, user, "is_active", "rands"); err != nil {
				return fmt.Errorf("unable to updateUserCols() for user ID: %d: %w", userID, err)
			}
		}
	}

	return committer.Commit()
}
