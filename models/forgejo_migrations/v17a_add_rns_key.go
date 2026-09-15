// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package forgejo_migrations

import (
	"forgejo.org/modules/timeutil"

	"code.forgejo.org/xorm/xorm"
)

func init() {
	registerMigration(&Migration{
		Description: "add rns_key table",
		Upgrade:     addRNSKeyTable,
	})
}

func addRNSKeyTable(x *xorm.Engine) error {
	type RNSKey struct {
		ID           int64              `xorm:"pk autoincr"`
		OwnerID      int64              `xorm:"INDEX NOT NULL"`
		Name         string             `xorm:"NOT NULL"`
		IdentityHash string             `xorm:"UNIQUE VARCHAR(32) NOT NULL"`
		Verified     bool               `xorm:"NOT NULL DEFAULT false"`
		CreatedUnix  timeutil.TimeStamp `xorm:"created"`
		UpdatedUnix  timeutil.TimeStamp `xorm:"updated"`
	}
	_, err := x.SyncWithOptions(xorm.SyncOptions{IgnoreDropIndices: true}, new(RNSKey))
	return err
}
