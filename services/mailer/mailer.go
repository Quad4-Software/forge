// Copyright 2019 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package mailer

import (
	"context"
	"sync/atomic"

	"forgejo.org/modules/setting"
	notify_service "forgejo.org/services/notify"

	"forgejo.org/services/lxmfnotify"
)

// notifierRegistered guards one-time notifier registration so the activity
// notifier is installed only when LXMF delivery is configured.
var notifierRegistered atomic.Bool

// NewContext installs the activity notifier when LXMF delivery is available.
func NewContext(ctx context.Context) {
	if setting.Service.EnableNotifyMail && lxmfnotify.Configured() && !notifierRegistered.Swap(true) {
		notify_service.RegisterNotifier(NewNotifier())
	}
}
