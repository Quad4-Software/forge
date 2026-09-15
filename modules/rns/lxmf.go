// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

package rns

import (
	"encoding/hex"
	"fmt"

	user_model "forgejo.org/models/user"
	"forgejo.org/modules/log"

	"github.com/Quad4-Software/Reticulum-Go/pkg/common"
	"github.com/Quad4-Software/Reticulum-Go/pkg/identity"
	"github.com/Quad4-Software/Reticulum-Go/pkg/packet"
	"github.com/Quad4-Software/Reticulum-Go/pkg/transport"
	"github.com/Quad4-Software/reticulum-go-protocols/pkg/lxmf"
)

// LXMFDelivery wraps the LXMF messenger used to deliver verification codes,
// invitations and notification messages to users identified by their
// Reticulum identity.
type LXMFDelivery struct {
	msgr *lxmf.Messenger
}

// NewLXMFDelivery creates the lxmf.delivery destination and messenger on the
// shared transport.
func NewLXMFDelivery(tr *transport.Transport, id *identity.Identity) (*LXMFDelivery, error) {
	msgr, err := lxmf.NewDeliveryMessenger(id, tr)
	if err != nil {
		return nil, err
	}
	// NewDeliveryMessenger registers the messenger as the transport
	// destination. Older versions do not delegate link requests to the
	// destination, which drops inbound direct-delivery links. Re-registering
	// a wrapper keeps the messenger packet path and restores link requests.
	tr.RegisterDestination(msgr.Destination().GetHash(), lxmfInbound{Messenger: msgr})
	return &LXMFDelivery{msgr: msgr}, nil
}

// lxmfInbound wraps the messenger so transport dispatch resolves both the
// packet receiver and the link request handler.
type lxmfInbound struct {
	*lxmf.Messenger
}

// Receive keeps packet handling on the messenger, which decrypts inbound
// LXMF payloads before dispatch.
func (w lxmfInbound) Receive(pkt *packet.Packet, iface common.NetworkInterface) bool {
	return w.Messenger.Receive(pkt, iface)
}

// HandleIncomingLinkRequest forwards link requests to the delivery
// destination wrapped by the messenger.
func (w lxmfInbound) HandleIncomingLinkRequest(pkt, tr any, iface common.NetworkInterface) error {
	return w.Messenger.Destination().HandleIncomingLinkRequest(pkt, tr, iface)
}

// Announce announces the lxmf.delivery destination so peers can reach this
// node for replies.
func (d *LXMFDelivery) Announce() {
	if dest := d.msgr.Destination(); dest != nil {
		_ = dest.Announce(false, nil, nil)
	}
}

// DestinationHash returns the hex encoded lxmf.delivery destination hash.
func (d *LXMFDelivery) DestinationHash() string {
	if d == nil || d.msgr == nil {
		return ""
	}
	return hex.EncodeToString(d.msgr.DestinationHash())
}

// SendText delivers a text message to the LXMF delivery destination derived
// from the recipients Reticulum identity hash. Delivery uses a direct link
// with path discovery, so the recipient does not need to be known in advance.
func (d *LXMFDelivery) SendText(identityHash, title, content string) error {
	if d == nil || d.msgr == nil {
		return fmt.Errorf("lxmf delivery is not enabled")
	}
	idHash, err := user_model.DecodeRNSIdentityHash(identityHash)
	if err != nil {
		return err
	}
	destHash := lxmf.DestHash(idHash)
	if destHash == nil {
		return fmt.Errorf("invalid identity hash")
	}
	msg, err := d.msgr.Compose(destHash, title, content, nil)
	if err != nil {
		return err
	}
	if err := d.msgr.SendDirect(msg); err != nil {
		return fmt.Errorf("lxmf delivery to <%s> failed: %w", identityHash, err)
	}
	log.Trace("Sent LXMF message to <%s>: %s", identityHash, title)
	return nil
}
