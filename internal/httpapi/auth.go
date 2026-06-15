package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

const passwordHashIterations = 120000

func generateSessionToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	digest := passwordDigest([]byte(password), salt, passwordHashIterations)
	return fmt.Sprintf(
		"sha256$%d$%s$%s",
		passwordHashIterations,
		base64.RawURLEncoding.EncodeToString(salt),
		base64.RawURLEncoding.EncodeToString(digest),
	), nil
}

func verifyPassword(password string, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations < 1 {
		return false
	}
	salt, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	actual := passwordDigest([]byte(password), salt, iterations)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func passwordDigest(password []byte, salt []byte, iterations int) []byte {
	block := make([]byte, 0, len(salt)+len(password)+sha256.Size)
	block = append(block, salt...)
	block = append(block, password...)
	sum := sha256.Sum256(block)
	digest := sum[:]
	for i := 1; i < iterations; i++ {
		block = block[:0]
		block = append(block, digest...)
		block = append(block, salt...)
		block = append(block, password...)
		sum = sha256.Sum256(block)
		digest = sum[:]
	}
	out := make([]byte, len(digest))
	copy(out, digest)
	return out
}
