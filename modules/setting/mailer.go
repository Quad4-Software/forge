// Copyright 2019 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package setting

import (
	"forgejo.org/modules/log"
)

func loadMailsFrom(rootCfg ConfigProvider) {
	loadRegisterMailFrom(rootCfg)
	loadNotifyMailFrom(rootCfg)
}

func loadRegisterMailFrom(rootCfg ConfigProvider) {
	if !rootCfg.Section("service").Key("REGISTER_EMAIL_CONFIRM").MustBool() {
		return
	}
	if !RNS.Enabled || !RNS.EnableLXMF {
		log.Warn("Register confirmation requires Reticulum LXMF delivery; activation codes cannot be delivered")
		return
	}
	Service.RegisterEmailConfirm = true
}

func loadNotifyMailFrom(rootCfg ConfigProvider) {
	if !rootCfg.Section("service").Key("ENABLE_NOTIFY_MAIL").MustBool() {
		return
	}
	if !RNS.Enabled || !RNS.EnableLXMF {
		log.Warn("Notify Mail Service: LXMF delivery is not enabled")
		return
	}
	Service.EnableNotifyMail = true
}
