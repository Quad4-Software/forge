// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

// Package rns embeds a Reticulum node in the Forgejo process. The node serves
// git repositories over the Reticulum network using the rngit wire protocol
// (destination git.repositories) and delivers messages over LXMF.
package rns

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"forgejo.org/modules/graceful"
	"forgejo.org/modules/log"
	"forgejo.org/modules/setting"

	"github.com/Quad4-Software/Reticulum-Go/pkg/common"
	"github.com/Quad4-Software/Reticulum-Go/pkg/identity"
	"github.com/Quad4-Software/Reticulum-Go/pkg/node"
	"github.com/Quad4-Software/Reticulum-Go/pkg/reticulumconfig"
	"github.com/Quad4-Software/Reticulum-Go/pkg/transport"
)

var (
	globalNode     *node.Node
	globalIdentity *identity.Identity
	gitServer      *GitServer
	pageServer     *PageServer
	lxmfDelivery   *LXMFDelivery
	stopAnnounce   chan struct{}
	initErr        error
	initOnce       sync.Once
)

// Enabled reports whether the embedded Reticulum node started successfully.
func Enabled() bool {
	return globalNode != nil
}

// Transport returns the transport of the embedded node, or nil when disabled.
func Transport() *transport.Transport {
	if globalNode == nil {
		return nil
	}
	return globalNode.Transport()
}

// Identity returns the node identity, or nil when disabled.
func Identity() *identity.Identity {
	return globalIdentity
}

// IdentityHash returns the hex encoded node identity hash.
func IdentityHash() string {
	if globalIdentity == nil {
		return ""
	}
	return globalIdentity.GetHexHash()
}

// GitDestinationHash returns the hex encoded git.repositories destination
// hash that clients use in rns:// URLs.
func GitDestinationHash() string {
	if gitServer == nil {
		return ""
	}
	return gitServer.DestinationHash()
}

// PageDestinationHash returns the hex encoded nomadnetwork.node destination
// hash that NomadNet clients browse.
func PageDestinationHash() string {
	if pageServer == nil {
		return ""
	}
	return pageServer.DestinationHash()
}

// LXMFDeliveryHash returns the hex encoded lxmf.delivery destination hash.
func LXMFDeliveryHash() string {
	if lxmfDelivery == nil {
		return ""
	}
	return lxmfDelivery.DestinationHash()
}

// SendLXMFText delivers a text message over LXMF to the Reticulum identity
// hash of a user. It is a no-op error when LXMF is not enabled.
func SendLXMFText(identityHash, title, content string) error {
	if lxmfDelivery == nil {
		return fmt.Errorf("rns lxmf delivery is not enabled")
	}
	return lxmfDelivery.SendText(identityHash, title, content)
}

// Init loads the Reticulum configuration, creates or loads the node identity,
// starts the embedded node and registers the git and LXMF destinations. It is
// a no-op when the [rns] section is disabled. Startup failures are logged and
// swallowed: the node is optional and the rest of Forgejo must keep running
// without it.
func Init(ctx context.Context) error {
	initOnce.Do(func() {
		initErr = initNode(ctx)
	})
	return initErr
}

func initNode(ctx context.Context) error {
	if err := startNode(ctx); err != nil {
		log.Error("Reticulum node failed to start, continuing without rns: %v", err)
	}
	return nil
}

func startNode(ctx context.Context) error {
	if !setting.RNS.Enabled {
		return nil
	}

	cfg, err := loadOrCreateConfig()
	if err != nil {
		return fmt.Errorf("rns: load config: %w", err)
	}

	id, err := loadOrCreateIdentity()
	if err != nil {
		return fmt.Errorf("rns: load identity: %w", err)
	}
	globalIdentity = id

	n, err := node.New(cfg)
	if err != nil {
		return fmt.Errorf("rns: create node: %w", err)
	}
	if err := n.Start(); err != nil {
		return fmt.Errorf("rns: start node: %w", err)
	}
	globalNode = n

	if setting.RNS.ServeGit {
		gitServer, err = NewGitServer(n.Transport(), id)
		if err != nil {
			return fmt.Errorf("rns: create git server: %w", err)
		}
	}

	if setting.RNS.ServePages {
		pageServer, err = NewPageServer(n.Transport(), id)
		if err != nil {
			return fmt.Errorf("rns: create page server: %w", err)
		}
	}

	if setting.RNS.EnableLXMF {
		lxmfDelivery, err = NewLXMFDelivery(n.Transport(), id)
		if err != nil {
			return fmt.Errorf("rns: create lxmf delivery: %w", err)
		}
	}

	stopAnnounce = make(chan struct{})
	if setting.RNS.AnnounceInterval >= 0 {
		announce()
		if setting.RNS.AnnounceInterval > 0 {
			go announceLoop(time.Duration(setting.RNS.AnnounceInterval)*time.Minute, stopAnnounce)
		}
	}

	graceful.GetManager().RunAtShutdown(ctx, func() {
		close(stopAnnounce)
		_ = n.Stop()
	})

	log.Info("Reticulum node started, identity <%s>, git destination <%s>", IdentityHash(), GitDestinationHash())
	return nil
}

func announce() {
	if gitServer != nil {
		gitServer.Announce()
	}
	if pageServer != nil {
		pageServer.Announce()
	}
	if lxmfDelivery != nil {
		lxmfDelivery.Announce()
	}
}

func announceLoop(interval time.Duration, stop chan struct{}) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			announce()
		case <-stop:
			return
		}
	}
}

// defaultInstanceName namespaces the shared-instance sockets to
// @rns/forgejo so the embedded node does not claim @rns/default, which
// belongs to a system rnsd. Claiming the default name makes every
// shared-instance client on the host attach to this node and inherit a
// transport that usually has no connectivity to the wider network.
const defaultInstanceName = "forgejo"

func loadOrCreateConfig() (*common.ReticulumConfig, error) {
	dir := setting.RNS.ConfigDir
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	configPath := filepath.Join(dir, reticulumconfig.DefaultConfigFileName)
	if _, err := os.Stat(configPath); errors.Is(err, os.ErrNotExist) {
		if err := reticulumconfig.CreateDefaultConfig(configPath); err != nil {
			return nil, err
		}
		log.Info("Created default Reticulum config at %s, review the interface settings", configPath)
	}
	cfg, err := reticulumconfig.LoadConfig(configPath)
	if err != nil {
		return nil, err
	}
	if cfg.ShareInstance && strings.TrimSpace(cfg.InstanceName) == "" {
		cfg.InstanceName = defaultInstanceName
	}
	return cfg, nil
}

func loadOrCreateIdentity() (*identity.Identity, error) {
	path := setting.RNS.IdentityFile
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		id, err := identity.New()
		if err != nil {
			return nil, err
		}
		if err := id.ToFile(path); err != nil {
			return nil, err
		}
		log.Info("Created new Reticulum identity at %s", path)
		return id, nil
	}
	return identity.FromFile(path)
}
