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

func Test_ForgeUserActivityValidation(t *testing.T) {
	note := forgefed.ForgeUserActivityNote{
		Type: ap.NoteType,
		Content: ap.NaturalLanguageValues{
			ap.NilLangRef: ap.Content("Any Content!"),
		},
		URL: ap.IRI("example.org/user-id/57"),
	}

	sut := forgefed.ForgeUserActivity{
		Type:  ap.CreateType,
		Actor: ap.IRI("example.org/user-id/23"),
		CC: ap.ItemCollection{
			ap.IRI("example.org/registration/public#2nd"),
		},
		To: ap.ItemCollection{
			ap.IRI("example.org/registration/public"),
		},

		Note: note,
	}

	valid, _ := validation.IsValid(sut)
	assert.True(t, valid, "sut expected to be valid: %v\n", sut.Validate())
}
