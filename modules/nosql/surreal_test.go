// Copyright 2026 The Quad4 Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package nosql

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testSurrealClient returns a client connected to the server given by
// TEST_SURREALDB_SERVER, e.g. "surreal://root:pass@127.0.0.1:8000/test/test".
// The test is skipped when the variable is unset.
func testSurrealClient(t *testing.T) RedisClient {
	t.Helper()
	conn := os.Getenv("TEST_SURREALDB_SERVER")
	if conn == "" {
		t.Skip("TEST_SURREALDB_SERVER not set; skipping SurrealDB integration test")
	}
	uri := ToRedisURI(conn)
	require.True(t, uri.Scheme == "surreal" || uri.Scheme == "surreals" || uri.Scheme == "surrealdb" || uri.Scheme == "surrealdbs")
	c, err := newSurrealClient(context.Background(), uri)
	require.NoError(t, err)
	require.NoError(t, c.Ping(context.Background()).Err())
	t.Cleanup(func() { require.NoError(t, c.Close()) })
	return c
}

func TestToRedisURISurreal(t *testing.T) {
	uri := ToRedisURI("surreal://root:secret@db.internal:8000/forge/cache?timeout=30s")
	assert.Equal(t, "surreal", uri.Scheme)
	assert.Equal(t, "db.internal:8000", uri.Host)
	assert.Equal(t, "/forge/cache", uri.Path)
	assert.Equal(t, "30s", uri.Query().Get("timeout"))
	pw, _ := uri.User.Password()
	assert.Equal(t, "secret", pw)
}

func TestSurrealURIParsing(t *testing.T) {
	// newSurrealClient will try to connect, so test the pure parsing part via ToRedisURI
	for _, tc := range []struct {
		conn   string
		scheme string
	}{
		{"surreal://host:8000/forge/cache", "surreal"},
		{"surreals://host:8000/forge/cache", "surreals"},
		{"surrealdb://host/forge", "surrealdb"},
	} {
		uri := ToRedisURI(tc.conn)
		assert.Equal(t, tc.scheme, uri.Scheme, tc.conn)
	}
}

func TestSurrealStrings(t *testing.T) {
	c := testSurrealClient(t)
	ctx := context.Background()

	key := "test:key/odd chars"
	require.NoError(t, c.Set(ctx, key, "value1", 0).Err())
	assert.Equal(t, "value1", c.Get(ctx, key).Val())

	// binary payload survives round trip
	bkey := "test:bin"
	blob := []byte{0x00, 0xff, 0x42, 0x10}
	require.NoError(t, c.Set(ctx, bkey, blob, 0).Err())
	assert.Equal(t, string(blob), c.Get(ctx, bkey).Val())

	// non-UTF-8 string payload (gob-encoded sessions arrive this way)
	bstr := string([]byte{0xff, 0xfe, 0x00, 0x01, 0x7f, 0x80})
	require.NoError(t, c.Set(ctx, "test:binstr", bstr, 0).Err())
	assert.Equal(t, bstr, c.Get(ctx, "test:binstr").Val())

	// missing key
	assert.Equal(t, redis.Nil, c.Get(ctx, "test:missing").Err())

	// expiry
	require.NoError(t, c.Set(ctx, "test:exp", "gone", time.Second).Err())
	assert.Equal(t, "gone", c.Get(ctx, "test:exp").Val())
	time.Sleep(1200 * time.Millisecond)
	assert.Equal(t, redis.Nil, c.Get(ctx, "test:exp").Err())

	// del + exists
	require.NoError(t, c.Set(ctx, "test:del1", "x", 0).Err())
	require.NoError(t, c.Set(ctx, "test:del2", "x", 0).Err())
	assert.Equal(t, int64(2), c.Exists(ctx, "test:del1", "test:del2").Val())
	assert.Equal(t, int64(2), c.Del(ctx, "test:del1", "test:del2").Val())
	assert.Equal(t, int64(0), c.Exists(ctx, "test:del1", "test:del2").Val())
	assert.Equal(t, int64(0), c.Del(ctx, "test:del1").Val())
}

func TestSurrealCounters(t *testing.T) {
	c := testSurrealClient(t)
	ctx := context.Background()

	assert.Equal(t, int64(1), c.Incr(ctx, "test:counter").Val())
	assert.Equal(t, int64(2), c.Incr(ctx, "test:counter").Val())
	assert.Equal(t, int64(1), c.Decr(ctx, "test:counter").Val())
	assert.Equal(t, "1", c.Get(ctx, "test:counter").Val())
	c.Del(ctx, "test:counter")
}

func TestSurrealLists(t *testing.T) {
	c := testSurrealClient(t)
	ctx := context.Background()
	key := "test:list"

	assert.Equal(t, int64(2), c.RPush(ctx, key, "a", "b").Val())
	assert.Equal(t, int64(3), c.RPush(ctx, key, "c").Val())
	assert.Equal(t, int64(3), c.LLen(ctx, key).Val())
	assert.Equal(t, "a", c.LPop(ctx, key).Val())
	assert.Equal(t, "b", c.LPop(ctx, key).Val())
	assert.Equal(t, "c", c.LPop(ctx, key).Val())
	assert.Equal(t, redis.Nil, c.LPop(ctx, key).Err())
	assert.Equal(t, int64(0), c.LLen(ctx, "test:list-missing").Val())
}

func TestSurrealSets(t *testing.T) {
	c := testSurrealClient(t)
	ctx := context.Background()
	key := "test:set"

	assert.Equal(t, int64(2), c.SAdd(ctx, key, "m1", "m2", "m1").Val())
	assert.Equal(t, int64(1), c.SAdd(ctx, key, "m2", "m3").Val())
	assert.True(t, c.SIsMember(ctx, key, "m1").Val())
	assert.False(t, c.SIsMember(ctx, key, "zz").Val())
	assert.Equal(t, int64(1), c.SRem(ctx, key, "m1").Val())
	assert.False(t, c.SIsMember(ctx, key, "m1").Val())
	assert.Equal(t, int64(0), c.SRem(ctx, key, "m1").Val())
	c.Del(ctx, key)
}

func TestSurrealHashes(t *testing.T) {
	c := testSurrealClient(t)
	ctx := context.Background()
	key := "test:hash"

	_, err := c.HSet(ctx, key, "f1", "v1", "f2", "v2").Result()
	require.NoError(t, err)
	keys := c.HKeys(ctx, key).Val()
	assert.ElementsMatch(t, []string{"f1", "f2"}, keys)
	assert.Equal(t, int64(1), c.HDel(ctx, key, "f1").Val())
	assert.Equal(t, []string{"f2"}, c.HKeys(ctx, key).Val())
	c.Del(ctx, key)
}

func TestSurrealDBSizeAndFlush(t *testing.T) {
	c := testSurrealClient(t)
	ctx := context.Background()

	require.NoError(t, c.FlushDB(ctx).Err())
	require.NoError(t, c.Set(ctx, "test:size1", "x", 0).Err())
	c.RPush(ctx, "test:sizelist", "a")
	assert.GreaterOrEqual(t, c.DBSize(ctx).Val(), int64(2))
	require.NoError(t, c.FlushDB(ctx).Err())
	assert.Equal(t, int64(0), c.DBSize(ctx).Val())
}

func TestSurrealConcurrent(t *testing.T) {
	c := testSurrealClient(t)
	ctx := context.Background()

	const workers = 20
	var wg sync.WaitGroup
	for i := range workers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			k := fmt.Sprintf("test:conc:%d", i)
			assert.NoError(t, c.Set(ctx, k, fmt.Sprint(i), 0).Err())
			assert.Equal(t, fmt.Sprint(i), c.Get(ctx, k).Val())
			assert.NoError(t, c.Incr(ctx, "test:conc:counter").Err())
			assert.NoError(t, c.RPush(ctx, "test:conc:list", i).Err())
		}(i)
	}
	wg.Wait()

	assert.Equal(t, fmt.Sprint(workers), c.Get(ctx, "test:conc:counter").Val())
	assert.Equal(t, int64(workers), c.LLen(ctx, "test:conc:list").Val())
	assert.Equal(t, int64(workers), c.Exists(ctx,
		"test:conc:0", "test:conc:1", "test:conc:2", "test:conc:3", "test:conc:4",
		"test:conc:5", "test:conc:6", "test:conc:7", "test:conc:8", "test:conc:9",
		"test:conc:10", "test:conc:11", "test:conc:12", "test:conc:13", "test:conc:14",
		"test:conc:15", "test:conc:16", "test:conc:17", "test:conc:18", "test:conc:19",
	).Val())
}
