// Copyright 2025 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package forgefed_test

import (
	"testing"

	"forgejo.org/modules/forgefed"
	"forgejo.org/modules/validation"

	ap "github.com/go-ap/activitypub"
	"github.com/stretchr/testify/assert"
)

func Test_NewForgeFollowValidation(t *testing.T) {
	sut := forgefed.ForgeFollow{
		Type:   ap.FollowType,
		Actor:  ap.IRI("example.org/alice"),
		Object: ap.IRI("example.org/bob"),
	}

	valid, err := validation.IsValid(sut)
	assert.True(t, valid, "sut is invalid: %v\n", err)

	sut = forgefed.ForgeFollow{
		Actor:  ap.IRI("example.org/alice"),
		Object: ap.IRI("example.org/bob"),
	}

	valid, err = validation.IsValid(sut)
	assert.False(t, valid, "sut is valid: %v\n", err)
}
