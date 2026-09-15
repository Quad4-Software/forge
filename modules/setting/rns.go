// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package setting

import (
	"path/filepath"

	"forgejo.org/modules/log"
)

// RNS holds the configuration for the embedded Reticulum node, which serves
// git repositories over the Reticulum network (rngit wire protocol) and
// delivers messages over LXMF.
var RNS = struct {
	// Enabled turns on the embedded Reticulum node.
	Enabled bool
	// ConfigDir is the directory holding the Reticulum configuration file
	// (interfaces, transport options) in the canonical Reticulum INI format.
	// If the file does not exist a minimal default is generated.
	ConfigDir string `ini:"CONFIG_DIR"`
	// IdentityFile is the path of the node identity. It is created if absent.
	IdentityFile string `ini:"IDENTITY_FILE"`
	// AnnounceInterval is the destination announce interval in minutes.
	// 0 disables periodic announces, -1 disables announcing entirely.
	AnnounceInterval int `ini:"ANNOUNCE_INTERVAL"`
	// ServeGit exposes repositories over the git.repositories destination.
	ServeGit bool `ini:"SERVE_GIT"`
	// EnableLXMF enables the LXMF router used for verification codes,
	// invitations and notifications.
	EnableLXMF bool `ini:"ENABLE_LXMF"`
	// AnonymousRead allows clone and fetch of public repositories by
	// unidentified Reticulum peers.
	AnonymousRead bool `ini:"ANONYMOUS_READ"`
	// EmailOptional allows registration and account flows without an email
	// address when a Reticulum identity is supplied instead. Activation
	// codes, password resets and security notices are then delivered over
	// LXMF. Requires EnableLXMF.
	EmailOptional bool `ini:"EMAIL_OPTIONAL"`
}{
	Enabled:          false,
	AnnounceInterval: 360,
	ServeGit:         true,
	EnableLXMF:       true,
	AnonymousRead:    true,
	EmailOptional:    false,
}

func loadRNSFrom(rootCfg ConfigProvider) {
	mustMapSetting(rootCfg, "rns", &RNS)
	if !RNS.Enabled {
		return
	}
	if RNS.ConfigDir == "" {
		RNS.ConfigDir = filepath.Join(AppDataPath, "rns")
	}
	if RNS.IdentityFile == "" {
		RNS.IdentityFile = filepath.Join(RNS.ConfigDir, "identity")
	}
	if RNS.AnnounceInterval < -1 {
		log.Warn("Invalid rns.ANNOUNCE_INTERVAL %d, using default", RNS.AnnounceInterval)
		RNS.AnnounceInterval = 360
	}
	if RNS.EmailOptional && !RNS.EnableLXMF {
		log.Warn("rns.EMAIL_OPTIONAL requires rns.ENABLE_LXMF, ignoring")
		RNS.EmailOptional = false
	}
}
