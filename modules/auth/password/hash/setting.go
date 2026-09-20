// Copyright 2023 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package hash

// DefaultHashAlgorithmName represents the default value of PASSWORD_HASH_ALGO
// configured in app.ini.
//
// It is NOT the same and does NOT map to the defaultEmptyHashAlgorithmSpecification.
//
// It will be dealiased as per aliasAlgorithmNames whereas
// defaultEmptyHashAlgorithmSpecification does not undergo dealiasing.
const DefaultHashAlgorithmName = "argon2id"

var DefaultHashAlgorithm *PasswordHashAlgorithm

// aliasAlgorithmNames provides a mapping between the value of PASSWORD_HASH_ALGO
// configured in the app.ini and the parameters used within the hashers internally.
//
// If it is necessary to change the default parameters for any hasher in future you
// should change these values and not those in argon2.go etc.
var aliasAlgorithmNames = map[string]string{
	// The argon2 hasher uses argon2id (argon2.IDKey). argon2id is the default
	// algorithm and argon2 is kept as an accepted alias for it. Parameters
	// follow the RFC 9106 second recommendation: 64MiB memory, 3 iterations,
	// 4 lanes.
	"argon2id":  "argon2$3$65536$4$50",
	"argon2":    "argon2id",
	"bcrypt":    "bcrypt$10",
	"scrypt":    "scrypt$65536$16$2$50",
	"pbkdf2":    "pbkdf2_v2", // pbkdf2 should default to pbkdf2_v2
	"pbkdf2_v1": "pbkdf2$10000$50",
	// pbkdf2_v2 does not use a lot of memory and is safer to use on less
	// powerful devices.
	"pbkdf2_v2": "pbkdf2$50000$50",
	// The pbkdf2_hi password algorithm is offered as a stronger alternative to the
	// slightly improved pbkdf2_v2 algorithm
	"pbkdf2_hi": "pbkdf2$320000$50",
}

var RecommendedHashAlgorithms = []string{
	"argon2id",
	"pbkdf2",
	"bcrypt",
	"scrypt",
	"pbkdf2_hi",
}

// hashAlgorithmToSpec converts an algorithm name or a specification to a full algorithm specification
func hashAlgorithmToSpec(algorithmName string) string {
	if algorithmName == "" {
		algorithmName = DefaultHashAlgorithmName
	}
	alias, has := aliasAlgorithmNames[algorithmName]
	for has {
		algorithmName = alias
		alias, has = aliasAlgorithmNames[algorithmName]
	}
	return algorithmName
}

// SetDefaultPasswordHashAlgorithm will take a provided algorithmName and de-alias it to
// a complete algorithm specification.
func SetDefaultPasswordHashAlgorithm(algorithmName string) (string, *PasswordHashAlgorithm) {
	algoSpec := hashAlgorithmToSpec(algorithmName)
	// now we get a full specification, e.g. pbkdf2$50000$50 rather than pbdkf2
	DefaultHashAlgorithm = Parse(algoSpec)
	return algoSpec, DefaultHashAlgorithm
}

// ConfigHashAlgorithm will try to find a "recommended algorithm name" defined by RecommendedHashAlgorithms for config
// This function is not fast and is only used for the installation page
func ConfigHashAlgorithm(algorithm string) string {
	algorithm = hashAlgorithmToSpec(algorithm)
	for _, recommAlgo := range RecommendedHashAlgorithms {
		if algorithm == hashAlgorithmToSpec(recommAlgo) {
			return recommAlgo
		}
	}
	return algorithm
}
