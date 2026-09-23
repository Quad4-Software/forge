// Copyright 2026 The Quad4 Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package nosql

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"forgejo.org/modules/log"

	"github.com/redis/go-redis/v9"
	surrealdb "github.com/surrealdb/surrealdb.go"
	"github.com/surrealdb/surrealdb.go/contrib/rews"
	"github.com/surrealdb/surrealdb.go/pkg/connection"
	"github.com/surrealdb/surrealdb.go/pkg/connection/gws"
	"github.com/surrealdb/surrealdb.go/pkg/logger"
	"github.com/surrealdb/surrealdb.go/pkg/models"
)

// surrealClient implements RedisClient on top of SurrealDB, so the existing
// cache, session and queue subsystems can run on SurrealDB by using a
// surreal:// connection URI.
//
// Connection URI format:
//
//	surreal://[user[:pass]@]host[:port]/[ns][/db][?auth=root|namespace|database&timeout=15s]
//	surreals://[user[:pass]@]host[:port]/[ns][/db][...same options, TLS...]
//
// Defaults: namespace "forge", database "forge", port 8000, auth level "root".
//
// Data layout inside the selected database:
//   kv     records hold string values with an optional expiry timestamp
//   lst    records hold queue lists as a single array field
//   st     records hold set members as a single array field
//   hfield records hold one hash field each via a composite record id

const (
	surrealTableKV    = "kv"
	surrealTableList  = "lst"
	surrealTableSet   = "st"
	surrealTableHash  = "hfield"
	surrealDefaultNS  = "forge"
	surrealDefaultDB  = "forge"
	surrealGCSweepSec = 300
)

type surrealClient struct {
	db     *surrealdb.DB
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	closed atomic.Bool
}

var _ RedisClient = (*surrealClient)(nil)

func kvID(key string) models.RecordID  { return models.NewRecordID(surrealTableKV, key) }
func lstID(key string) models.RecordID { return models.NewRecordID(surrealTableList, key) }
func setID(key string) models.RecordID { return models.NewRecordID(surrealTableSet, key) }

// surrealToString converts a redis-style value argument to what we store.
// []byte and non-UTF-8 strings are kept as bytes so binary gob payloads
// (sessions) stay intact - CBOR text strings must be valid UTF-8 or the
// request is rejected at the protocol level.
func surrealToString(v any) any {
	switch v := v.(type) {
	case []byte:
		return v
	case string:
		if !utf8.ValidString(v) {
			return []byte(v)
		}
		return v
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

// surrealString converts a decoded SurrealDB value back to a Go string.
func surrealString(v any) (string, bool) {
	switch v := v.(type) {
	case string:
		return v, true
	case []byte:
		return string(v), true
	case int64:
		return strconv.FormatInt(v, 10), true
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), true
	}
	return "", false
}

func surrealInt(v any) int64 {
	switch v := v.(type) {
	case int64:
		return v
	case uint64:
		return int64(v)
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	}
	return 0
}

func newSurrealClient(ctx context.Context, uri *url.URL) (RedisClient, error) {
	scheme := "ws"
	if uri.Scheme == "surreals" || uri.Scheme == "surrealdbs" {
		scheme = "wss"
	}
	host := uri.Host
	if host == "" {
		return nil, fmt.Errorf("surreal connection URI requires a host: %q", uri.Redacted())
	}
	if !strings.Contains(host, ":") {
		host += ":8000"
	}

	ns, database := surrealDefaultNS, surrealDefaultDB
	segs := strings.Split(strings.Trim(uri.Path, "/"), "/")
	switch {
	case len(segs) >= 2 && segs[1] != "":
		ns, database = segs[0], segs[1]
	case len(segs) == 1 && segs[0] != "":
		database = segs[0]
	}

	authLevel := "root"
	timeout := 15 * time.Second
	for k, v := range uri.Query() {
		switch replacer.Replace(strings.ToLower(k)) {
		case "ns", "namespace":
			ns = v[0]
		case "db", "database":
			database = v[0]
		case "user", "username":
			if pw, ok := uri.User.Password(); ok {
				uri.User = url.UserPassword(v[0], pw)
			} else {
				uri.User = url.User(v[0])
			}
		case "pass", "password":
			uri.User = url.UserPassword(uri.User.Username(), v[0])
		case "auth":
			authLevel = strings.ToLower(v[0])
		case "timeout":
			if t := valToTimeDuration(v); t > 0 {
				timeout = t
			}
		}
	}

	endpoint, err := url.Parse(scheme + "://" + host)
	if err != nil {
		return nil, fmt.Errorf("invalid surreal endpoint: %w", err)
	}
	conf := connection.NewConfig(endpoint)
	conf.Logger = logger.New(slog.NewTextHandler(io.Discard, nil))
	if os.Getenv("SURREAL_DEBUG") != "" {
		conf.Logger = logger.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	}

	conn := rews.New(
		func(ctx context.Context) (*gws.Connection, error) {
			return gws.New(conf).SetTimeout(timeout), nil
		},
		5*time.Second,
		conf.Unmarshaler,
		conf.Logger,
	)

	cctx, cancel := context.WithTimeout(ctx, timeout)
	err = conn.Connect(cctx)
	cancel()
	if err != nil {
		return nil, fmt.Errorf("surreal connect %s://%s: %w", scheme, host, err)
	}

	db, err := surrealdb.FromConnection(ctx, conn)
	if err != nil {
		return nil, err
	}

	user := uri.User.Username()
	pass, _ := uri.User.Password()
	if user == "" && pass != "" {
		user = "root"
	}
	if user != "" {
		auth := surrealdb.Auth{Username: user, Password: pass}
		switch authLevel {
		case "namespace", "ns":
			auth.Namespace = ns
		case "database", "db":
			auth.Namespace = ns
			auth.Database = database
		}
		if _, err := db.SignIn(ctx, auth); err != nil {
			_ = db.Close(ctx)
			return nil, fmt.Errorf("surreal signin: %w", err)
		}
	}

	// Provision namespace, database and tables. DEFINE NAMESPACE/DATABASE
	// require elevated credentials; with a namespace- or database-scoped user
	// (?auth=namespace|database) they must exist already, so permission
	// failures are tolerated and the subsequent Use calls decide whether the
	// namespace and database actually exist.
	if _, err := surrealdb.Query[any](ctx, db,
		"DEFINE NAMESPACE IF NOT EXISTS "+surrealIdent(ns), nil); err != nil {
		log.Warn("surreal: could not define namespace %q (using %s credentials): %v", ns, authLevel, err)
	}
	if err := db.Use(ctx, ns, ""); err != nil {
		_ = db.Close(ctx)
		return nil, fmt.Errorf("surreal use namespace %q: %w", ns, err)
	}
	if _, err := surrealdb.Query[any](ctx, db,
		"DEFINE DATABASE IF NOT EXISTS "+surrealIdent(database), nil); err != nil {
		log.Warn("surreal: could not define database %q (using %s credentials): %v", database, authLevel, err)
	}
	if err := db.Use(ctx, ns, database); err != nil {
		_ = db.Close(ctx)
		return nil, fmt.Errorf("surreal use database %q: %w", database, err)
	}
	if _, err := surrealdb.Query[any](ctx, db,
		"DEFINE TABLE IF NOT EXISTS "+surrealTableKV+" SCHEMALESS; "+
			"DEFINE TABLE IF NOT EXISTS "+surrealTableList+" SCHEMALESS; "+
			"DEFINE TABLE IF NOT EXISTS "+surrealTableSet+" SCHEMALESS; "+
			"DEFINE TABLE IF NOT EXISTS "+surrealTableHash+" SCHEMALESS", nil); err != nil {
		log.Warn("surreal: could not predefine tables, they will be created on first write: %v", err)
	}

	mctx, mcancel := context.WithCancel(ctx)
	c := &surrealClient{db: db, ctx: mctx, cancel: mcancel, done: make(chan struct{})}
	go c.expirySweep()
	return c, nil
}

// surrealIdent quotes a namespace identifier for use in DEFINE statements.
// Identifiers come from configuration, never from user input.
func surrealIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "") + "`"
}

// surrealRetryable reports whether an error is a transaction conflict that
// SurrealDB says can be retried.
func surrealRetryable(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "conflict") ||
		strings.Contains(s, "failed transaction") ||
		strings.Contains(s, "can be retried")
}

func (c *surrealClient) query(ctx context.Context, sql string, vars map[string]any) ([]surrealdb.QueryResult[any], error) {
	if c.closed.Load() {
		return nil, redis.ErrClosed
	}
	var out []surrealdb.QueryResult[any]
	for attempt := range 10 {
		res, err := surrealdb.Query[any](ctx, c.db, sql, vars)
		if err != nil {
			if surrealRetryable(err) && attempt < 9 {
				time.Sleep(time.Duration(5*(attempt+1)) * time.Millisecond)
				continue
			}
			return nil, err
		}
		out = *res
		conflict := false
		for i := range out {
			if out[i].Status != "OK" {
				msg := fmt.Sprint(out[i].Result)
				// Schemaless tables that were never written to report "does not
				// exist" on full-table scans. Treat them as empty so that flush,
				// delete and count operations on fresh databases behave like redis.
				if strings.Contains(msg, "does not exist") {
					out[i].Result = []any{}
					out[i].Status = "OK"
					continue
				}
				if surrealRetryable(fmt.Errorf("%s", msg)) && attempt < 9 {
					conflict = true
					break
				}
				return nil, fmt.Errorf("surreal statement %d failed: %v", i, out[i].Result)
			}
		}
		if !conflict {
			return out, nil
		}
		time.Sleep(time.Duration(5*(attempt+1)) * time.Millisecond)
	}
	return out, fmt.Errorf("surreal query failed after retries: transaction conflicts")
}

func (c *surrealClient) expirySweep() {
	defer close(c.done)
	ticker := time.NewTicker(surrealGCSweepSec * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(c.ctx, 30*time.Second)
			_, err := c.query(ctx,
				"DELETE "+surrealTableKV+" WHERE exp IS NOT NONE AND exp IS NOT NULL AND exp <= $now",
				map[string]any{"now": time.Now().Unix()})
			cancel()
			if err != nil && !c.closed.Load() {
				log.Warn("surreal expiry sweep: %v", err)
			}
		}
	}
}

// kvGet returns the live string value for a key, lazily deleting expired rows.
func (c *surrealClient) kvGet(ctx context.Context, key string) (string, error) {
	res, err := c.query(ctx, "SELECT v, exp FROM ONLY $rid", map[string]any{"rid": kvID(key)})
	if err != nil {
		return "", err
	}
	m, ok := res[0].Result.(map[string]any)
	if !ok || m == nil {
		return "", redis.Nil
	}
	if exp := surrealInt(m["exp"]); exp > 0 && exp <= time.Now().Unix() {
		_, _ = c.query(ctx, "DELETE $rid", map[string]any{"rid": kvID(key)})
		return "", redis.Nil
	}
	s, ok := surrealString(m["v"])
	if !ok {
		return "", redis.Nil
	}
	return s, nil
}

func (c *surrealClient) Get(ctx context.Context, key string) *redis.StringCmd {
	s, err := c.kvGet(ctx, key)
	return redis.NewStringResult(s, err)
}

func (c *surrealClient) Set(ctx context.Context, key string, value any, expiration time.Duration) *redis.StatusCmd {
	var err error
	if expiration > 0 {
		_, err = c.query(ctx, "UPSERT $rid CONTENT {v: $v, exp: $exp}",
			map[string]any{"rid": kvID(key), "v": surrealToString(value), "exp": time.Now().Add(expiration).Unix()})
	} else {
		_, err = c.query(ctx, "UPSERT $rid CONTENT {v: $v}",
			map[string]any{"rid": kvID(key), "v": surrealToString(value)})
	}
	return redis.NewStatusResult("OK", err)
}

func (c *surrealClient) Del(ctx context.Context, keys ...string) *redis.IntCmd {
	kvIDs, lstIDs, setIDs := make([]models.RecordID, 0, len(keys)), make([]models.RecordID, 0, len(keys)), make([]models.RecordID, 0, len(keys))
	ks := make([]any, 0, len(keys))
	for _, k := range keys {
		kvIDs = append(kvIDs, kvID(k))
		lstIDs = append(lstIDs, lstID(k))
		setIDs = append(setIDs, setID(k))
		ks = append(ks, k)
	}
	res, err := c.query(ctx,
		"DELETE $k1 RETURN BEFORE; "+
			"DELETE $k2 RETURN BEFORE; "+
			"DELETE $k3 RETURN BEFORE; "+
			"DELETE "+surrealTableHash+" WHERE h IN $k4 RETURN BEFORE",
		map[string]any{"k1": kvIDs, "k2": lstIDs, "k3": setIDs, "k4": ks})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	var n int64
	for _, r := range res {
		if arr, ok := r.Result.([]any); ok {
			n += int64(len(arr))
		}
	}
	return redis.NewIntResult(n, nil)
}

func (c *surrealClient) Exists(ctx context.Context, keys ...string) *redis.IntCmd {
	kvIDs, lstIDs, setIDs := make([]models.RecordID, 0, len(keys)), make([]models.RecordID, 0, len(keys)), make([]models.RecordID, 0, len(keys))
	ks := make([]any, 0, len(keys))
	for _, k := range keys {
		kvIDs = append(kvIDs, kvID(k))
		lstIDs = append(lstIDs, lstID(k))
		setIDs = append(setIDs, setID(k))
		ks = append(ks, k)
	}
	res, err := c.query(ctx,
		"RETURN array::len(SELECT VALUE id FROM $k1 WHERE exp IS NONE OR exp IS NULL OR exp > $now)"+
			" + array::len(SELECT VALUE id FROM $k2)"+
			" + array::len(SELECT VALUE id FROM $k3)"+
			" + array::len(SELECT VALUE id FROM "+surrealTableHash+" WHERE h IN $k4)",
		map[string]any{"k1": kvIDs, "k2": lstIDs, "k3": setIDs, "k4": ks, "now": time.Now().Unix()})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(surrealInt(res[0].Result), nil)
}

func (c *surrealClient) incrBy(ctx context.Context, key string, delta int64) *redis.IntCmd {
	res, err := c.query(ctx,
		"BEGIN TRANSACTION;"+
			" LET $r = (UPSERT $rid SET v = type::string(type::int(v ?? \"0\") + $d) RETURN v);"+
			" COMMIT TRANSACTION;"+
			" RETURN type::int($r[0].v);",
		map[string]any{"rid": kvID(key), "d": delta})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(surrealInt(res[len(res)-1].Result), nil)
}

func (c *surrealClient) Incr(ctx context.Context, key string) *redis.IntCmd {
	return c.incrBy(ctx, key, 1)
}

func (c *surrealClient) Decr(ctx context.Context, key string) *redis.IntCmd {
	return c.incrBy(ctx, key, -1)
}

func (c *surrealClient) RPush(ctx context.Context, key string, values ...any) *redis.IntCmd {
	vs := make([]any, 0, len(values))
	for _, v := range values {
		vs = append(vs, surrealToString(v))
	}
	res, err := c.query(ctx,
		"BEGIN TRANSACTION;"+
			" LET $r = (UPSERT $rid SET items = array::concat(items ?? [], $vs));"+
			" COMMIT TRANSACTION;"+
			" RETURN array::len($r[0].items);",
		map[string]any{"rid": lstID(key), "vs": vs})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(surrealInt(res[len(res)-1].Result), nil)
}

func (c *surrealClient) LPop(ctx context.Context, key string) *redis.StringCmd {
	res, err := c.query(ctx,
		"BEGIN TRANSACTION;"+
			" LET $r = (UPDATE ONLY $rid SET items = array::slice(items ?? [], 1) RETURN BEFORE);"+
			" COMMIT TRANSACTION;"+
			" RETURN $r;",
		map[string]any{"rid": lstID(key)})
	if err != nil {
		return redis.NewStringResult("", err)
	}
	m, ok := res[len(res)-1].Result.(map[string]any)
	if !ok || m == nil {
		return redis.NewStringResult("", redis.Nil)
	}
	items, ok := m["items"].([]any)
	if !ok || len(items) == 0 {
		return redis.NewStringResult("", redis.Nil)
	}
	s, ok := surrealString(items[0])
	if !ok {
		return redis.NewStringResult("", redis.Nil)
	}
	return redis.NewStringResult(s, nil)
}

func (c *surrealClient) LLen(ctx context.Context, key string) *redis.IntCmd {
	res, err := c.query(ctx,
		"RETURN array::len((SELECT items FROM ONLY $rid).items ?? [])",
		map[string]any{"rid": lstID(key)})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(surrealInt(res[0].Result), nil)
}

func (c *surrealClient) SAdd(ctx context.Context, key string, members ...any) *redis.IntCmd {
	vs := make([]any, 0, len(members))
	for _, m := range members {
		vs = append(vs, surrealToString(m))
	}
	res, err := c.query(ctx,
		"BEGIN TRANSACTION;"+
			" LET $m0 = array::len((SELECT members FROM ONLY $rid).members ?? []);"+
			" UPSERT $rid SET members = array::union(members ?? [], $vs);"+
			" LET $m1 = array::len((SELECT members FROM ONLY $rid).members ?? []);"+
			" COMMIT TRANSACTION;"+
			" RETURN $m1 - $m0;",
		map[string]any{"rid": setID(key), "vs": vs})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(surrealInt(res[len(res)-1].Result), nil)
}

func (c *surrealClient) SRem(ctx context.Context, key string, members ...any) *redis.IntCmd {
	vs := make([]any, 0, len(members))
	for _, m := range members {
		vs = append(vs, surrealToString(m))
	}
	res, err := c.query(ctx,
		"BEGIN TRANSACTION;"+
			" LET $m0 = array::len((SELECT members FROM ONLY $rid).members ?? []);"+
			" UPDATE $rid SET members = array::complement(members ?? [], $vs);"+
			" LET $m1 = array::len((SELECT members FROM ONLY $rid).members ?? []);"+
			" COMMIT TRANSACTION;"+
			" RETURN $m0 - $m1;",
		map[string]any{"rid": setID(key), "vs": vs})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(surrealInt(res[len(res)-1].Result), nil)
}

func (c *surrealClient) SIsMember(ctx context.Context, key string, member any) *redis.BoolCmd {
	res, err := c.query(ctx,
		"RETURN ((SELECT members FROM ONLY $rid).members ?? []) CONTAINS $m",
		map[string]any{"rid": setID(key), "m": surrealToString(member)})
	if err != nil {
		return redis.NewBoolResult(false, err)
	}
	b, _ := res[0].Result.(bool)
	return redis.NewBoolResult(b, nil)
}

func (c *surrealClient) HSet(ctx context.Context, key string, values ...any) *redis.IntCmd {
	if len(values)%2 != 0 {
		return redis.NewIntResult(0, fmt.Errorf("surreal hset: odd number of field/value arguments"))
	}
	pairs := make([]map[string]any, 0, len(values)/2)
	for i := 0; i+1 < len(values); i += 2 {
		f, ok := values[i].(string)
		if !ok {
			f = fmt.Sprint(values[i])
		}
		pairs = append(pairs, map[string]any{
			"f":   f,
			"v":   surrealToString(values[i+1]),
			"rid": models.NewRecordID(surrealTableHash, []any{key, f}),
		})
	}
	_, err := c.query(ctx,
		"FOR $p IN $pairs { UPSERT $p.rid CONTENT {h: $h, f: $p.f, v: $p.v}; }",
		map[string]any{"h": key, "pairs": pairs})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(int64(len(pairs)), nil)
}

func (c *surrealClient) HDel(ctx context.Context, key string, fields ...string) *redis.IntCmd {
	fs := make([]any, 0, len(fields))
	for _, f := range fields {
		fs = append(fs, f)
	}
	res, err := c.query(ctx,
		"DELETE "+surrealTableHash+" WHERE h = $h AND f IN $fs RETURN BEFORE",
		map[string]any{"h": key, "fs": fs})
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	if arr, ok := res[0].Result.([]any); ok {
		return redis.NewIntResult(int64(len(arr)), nil)
	}
	return redis.NewIntResult(0, nil)
}

func (c *surrealClient) HKeys(ctx context.Context, key string) *redis.StringSliceCmd {
	res, err := c.query(ctx,
		"SELECT VALUE f FROM "+surrealTableHash+" WHERE h = $h",
		map[string]any{"h": key})
	if err != nil {
		return redis.NewStringSliceResult(nil, err)
	}
	arr, _ := res[0].Result.([]any)
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := surrealString(v); ok {
			out = append(out, s)
		}
	}
	return redis.NewStringSliceResult(out, nil)
}

func (c *surrealClient) DBSize(ctx context.Context) *redis.IntCmd {
	res, err := c.query(ctx,
		"RETURN ((SELECT count() FROM "+surrealTableKV+" GROUP ALL)[0].count ?? 0)"+
			" + ((SELECT count() FROM "+surrealTableList+" GROUP ALL)[0].count ?? 0)"+
			" + ((SELECT count() FROM "+surrealTableSet+" GROUP ALL)[0].count ?? 0)"+
			" + ((SELECT count() FROM "+surrealTableHash+" GROUP ALL)[0].count ?? 0)",
		nil)
	if err != nil {
		return redis.NewIntResult(0, err)
	}
	return redis.NewIntResult(surrealInt(res[0].Result), nil)
}

func (c *surrealClient) FlushDB(ctx context.Context) *redis.StatusCmd {
	_, err := c.query(ctx,
		"DELETE "+surrealTableKV+"; DELETE "+surrealTableList+"; DELETE "+surrealTableSet+"; DELETE "+surrealTableHash,
		nil)
	return redis.NewStatusResult("OK", err)
}

func (c *surrealClient) Ping(ctx context.Context) *redis.StatusCmd {
	_, err := c.query(ctx, "RETURN true", nil)
	return redis.NewStatusResult("PONG", err)
}

func (c *surrealClient) Close() error {
	if c.closed.CompareAndSwap(false, true) {
		c.cancel()
		<-c.done
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return c.db.Close(ctx)
	}
	return nil
}
