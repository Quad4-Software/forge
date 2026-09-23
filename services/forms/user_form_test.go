// Copyright 2018 The Gogs Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package forms

import (
	"strconv"
	"testing"

	auth_model "forgejo.org/models/auth"
	"forgejo.org/modules/setting"
	"forgejo.org/modules/test"
	"forgejo.org/modules/validation"

	"github.com/gobwas/glob"
	"github.com/stretchr/testify/assert"
)

func TestIsEmailDomainAllowed_Empty(t *testing.T) {
	defer test.MockVariableValue(&setting.Service.EmailDomainAllowList, nil)()

	emailValid, ok := validation.IsEmailDomainAllowed("")
	assert.False(t, emailValid)
	assert.False(t, ok)
}

func TestIsEmailDomainAllowed_InvalidEmail(t *testing.T) {
	defer test.MockVariableValue(&setting.Service.EmailDomainAllowList, []glob.Glob{glob.MustCompile("gitea.io")})()

	tt := []struct {
		email string
	}{
		{"invalid-email"},
		{"gitea.io"},
	}

	for _, v := range tt {
		_, ok := validation.IsEmailDomainAllowed(v.email)
		assert.False(t, ok)
	}
}

func TestIsEmailDomainAllowed_AllowedEmail(t *testing.T) {
	defer test.MockVariableValue(&setting.Service.EmailDomainAllowList, []glob.Glob{glob.MustCompile("gitea.io"), glob.MustCompile("*.allow")})()

	tt := []struct {
		email string
		valid bool
	}{
		{"security@gitea.io", true},
		{"security@gITea.io", true},
		{"invalid", false},
		{"seee@example.com", false},

		{"user@my.allow", true},
		{"user@my.allow1", false},
	}

	for _, v := range tt {
		_, ok := validation.IsEmailDomainAllowed(v.email)
		assert.Equal(t, v.valid, ok)
	}
}

func TestIsEmailDomainAllowed_BlockedEmail(t *testing.T) {
	defer test.MockVariableValue(&setting.Service.EmailDomainBlockList, []glob.Glob{glob.MustCompile("gitea.io"), glob.MustCompile("*.block")})()

	tt := []struct {
		email string
		valid bool
	}{
		{"security@gitea.io", false},
		{"security@gitea.example", true},

		{"user@my.block", false},
		{"user@my.block1", true},
	}

	for _, v := range tt {
		_, ok := validation.IsEmailDomainAllowed(v.email)
		assert.Equal(t, v.valid, ok)
	}
}

func TestNewAccessTokenForm_GetScope(t *testing.T) {
	tests := []struct {
		form        NewAccessTokenPostForm
		scope       auth_model.AccessTokenScope
		expectedErr error
	}{
		{
			form:  NewAccessTokenPostForm{Name: "test", Scope: []string{"read:repository"}},
			scope: "read:repository",
		},
		{
			form:  NewAccessTokenPostForm{Name: "test", Scope: []string{"read:repository", "write:user"}},
			scope: "read:repository,write:user",
		},
	}

	for i, test := range tests {
		t.Run(strconv.Itoa(i), func(t *testing.T) {
			scope, err := test.form.GetScope()
			assert.Equal(t, test.expectedErr, err)
			assert.Equal(t, test.scope, scope)
		})
	}
}
