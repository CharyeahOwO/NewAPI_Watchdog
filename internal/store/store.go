package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/config"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/core"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type ChannelView struct {
	ChannelID              int64              `json:"channel_id"`
	Name                   string             `json:"name"`
	Type                   string             `json:"type,omitempty"`
	NewAPIStatus           string             `json:"newapi_status,omitempty"`
	WatchdogStatus         core.ChannelStatus `json:"watchdog_status"`
	Models                 []string           `json:"models"`
	TestModel              string             `json:"test_model,omitempty"`
	ProbeModels            []string           `json:"probe_models,omitempty"`
	GroupName              string             `json:"group_name"`
	AutoBan                *bool              `json:"auto_ban"`
	NewAPIDisabled         bool               `json:"newapi_disabled"`
	WatchdogEnabled        bool               `json:"watchdog_enabled"`
	AutoDisabledByWatchdog bool               `json:"auto_disabled_by_watchdog"`
	ConsecutiveFailures    int                `json:"consecutive_failures"`
	ConsecutiveSuccesses   int                `json:"consecutive_successes"`
	LastProbeAt            string             `json:"last_probe_at,omitempty"`
	LastSuccessAt          string             `json:"last_success_at,omitempty"`
	LastFailureAt          string             `json:"last_failure_at,omitempty"`
	LastError              string             `json:"last_error,omitempty"`
	LastLatencyMS          *int64             `json:"last_latency_ms"`
	LastHTTPStatus         *int               `json:"last_http_status"`
	SuccessRate1h          *float64           `json:"success_rate_1h"`
	SuccessRate24h         *float64           `json:"success_rate_24h"`
}

type ModelView struct {
	Model            string   `json:"model"`
	GroupName        string   `json:"group_name"`
	TotalChannels    int      `json:"total_channels"`
	Healthy          int      `json:"healthy"`
	Degraded         int      `json:"degraded"`
	Down             int      `json:"down"`
	AutoDisabled     int      `json:"auto_disabled"`
	ManuallyDisabled int      `json:"manually_disabled"`
	AvgLatencyMS     *float64 `json:"avg_latency_ms"`
	SuccessRate1h    *float64 `json:"success_rate_1h"`
	SuccessRate24h   *float64 `json:"success_rate_24h"`
	SnapshotAt       string   `json:"snapshot_at"`
}

type StatusEvent struct {
	ID             int64  `json:"id"`
	ChannelID      *int64 `json:"channel_id"`
	PreviousStatus string `json:"previous_status,omitempty"`
	CurrentStatus  string `json:"current_status"`
	Reason         string `json:"reason,omitempty"`
	Action         string `json:"action,omitempty"`
	DryRun         bool   `json:"dry_run"`
	CreatedAt      string `json:"created_at"`
}

type RunView struct {
	ID           string `json:"id"`
	StartedAt    string `json:"started_at"`
	FinishedAt   string `json:"finished_at,omitempty"`
	Status       string `json:"status"`
	ChannelsSeen int    `json:"channels_seen"`
	ProbesTotal  int    `json:"probes_total"`
	ProbesOK     int    `json:"probes_ok"`
	ProbesFailed int    `json:"probes_failed"`
	ActionsTaken int    `json:"actions_taken"`
	Error        string `json:"error,omitempty"`
}

type StatusSnapshot struct {
	Summary       StatusSummary `json:"summary"`
	Channels      []ChannelView `json:"channels"`
	Models        []ModelView   `json:"models"`
	Events        []StatusEvent `json:"events"`
	Runs          []RunView     `json:"runs"`
	GeneratedAt   string        `json:"generated_at,omitempty"`
	DryRun        bool          `json:"dry_run"`
	NewAPIBaseURL string        `json:"newapi_base_url"`
}

type StatusSummary struct {
	TotalChannels int            `json:"total_channels"`
	Counts        map[string]int `json:"counts"`
}

func Open(ctx context.Context, sqlitePath string) (*Store, error) {
	if sqlitePath == "" {
		return nil, errors.New("sqlite path is required")
	}
	if sqlitePath != ":memory:" && !strings.HasPrefix(sqlitePath, "file:") {
		if err := os.MkdirAll(filepath.Dir(sqlitePath), 0o755); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", sqliteDSN(sqlitePath))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) DB() *sql.DB {
	return s.db
}

func (s *Store) Migrate(ctx context.Context) error {
	schema := `
CREATE TABLE IF NOT EXISTS channel_states (
	channel_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT,
	newapi_status TEXT,
	watchdog_status TEXT NOT NULL DEFAULT 'unknown',
	models_json TEXT NOT NULL DEFAULT '[]',
	test_model TEXT,
	group_name TEXT NOT NULL DEFAULT 'default',
	auto_ban INTEGER,
	newapi_disabled INTEGER NOT NULL DEFAULT 0,
	auto_disabled_by_watchdog INTEGER NOT NULL DEFAULT 0,
	consecutive_failures INTEGER NOT NULL DEFAULT 0,
	consecutive_successes INTEGER NOT NULL DEFAULT 0,
	last_probe_at TEXT,
	last_success_at TEXT,
	last_failure_at TEXT,
	last_error TEXT,
	last_latency_ms INTEGER,
	last_http_status INTEGER,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS probe_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT,
	channel_id INTEGER NOT NULL,
	model TEXT,
	ok INTEGER NOT NULL,
	latency_ms INTEGER NOT NULL,
	error_class TEXT NOT NULL,
	error_message TEXT,
	http_status INTEGER,
	response_excerpt TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_probe_events_channel_time ON probe_events(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_probe_events_model_time ON probe_events(model, created_at);

CREATE TABLE IF NOT EXISTS status_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	channel_id INTEGER,
	previous_status TEXT,
	current_status TEXT NOT NULL,
	reason TEXT,
	action TEXT,
	dry_run INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_status_events_channel_time ON status_events(channel_id, created_at);

CREATE TABLE IF NOT EXISTS watchdog_runs (
	id TEXT PRIMARY KEY,
	started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	finished_at TEXT,
	status TEXT NOT NULL DEFAULT 'running',
	channels_seen INTEGER NOT NULL DEFAULT 0,
	probes_total INTEGER NOT NULL DEFAULT 0,
	probes_ok INTEGER NOT NULL DEFAULT 0,
	probes_failed INTEGER NOT NULL DEFAULT 0,
	actions_taken INTEGER NOT NULL DEFAULT 0,
	error TEXT
);

CREATE TABLE IF NOT EXISTS model_health_snapshots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	model TEXT NOT NULL,
	group_name TEXT NOT NULL DEFAULT 'default',
	total_channels INTEGER NOT NULL,
	healthy INTEGER NOT NULL,
	degraded INTEGER NOT NULL,
	down INTEGER NOT NULL,
	auto_disabled INTEGER NOT NULL,
	manually_disabled INTEGER NOT NULL,
	avg_latency_ms REAL,
	success_rate_1h REAL,
	success_rate_24h REAL,
	snapshot_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_model_snapshots_model_time ON model_health_snapshots(model, snapshot_at);

CREATE TABLE IF NOT EXISTS app_settings (
	key TEXT PRIMARY KEY,
	value_json TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`
	_, err := s.db.ExecContext(ctx, schema)
	return err
}

func (s *Store) Health(ctx context.Context) error {
	var one int
	return s.db.QueryRowContext(ctx, "SELECT 1").Scan(&one)
}

func (s *Store) RuntimeConfig(ctx context.Context, fallback config.Config) (config.Config, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT value_json FROM app_settings WHERE key = 'runtime_config'").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		if err := s.SaveRuntimeConfig(ctx, fallback); err != nil {
			return fallback, err
		}
		return fallback, nil
	}
	if err != nil {
		return fallback, err
	}
	cfg := fallback
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return fallback, err
	}
	cfg.Server = fallback.Server
	cfg.Database = fallback.Database
	return cfg, nil
}

func (s *Store) SaveRuntimeConfig(ctx context.Context, cfg config.Config) error {
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO app_settings (key, value_json, updated_at)
VALUES ('runtime_config', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET
	value_json = excluded.value_json,
	updated_at = excluded.updated_at
`, string(data))
	return err
}

func (s *Store) UpsertChannel(ctx context.Context, channel core.ChannelInfo) error {
	models, err := json.Marshal(channel.Models)
	if err != nil {
		return err
	}
	group := channel.EffectiveGroup()
	autoBan := nullableBool(channel.AutoBan)
	_, err = s.db.ExecContext(ctx, `
INSERT INTO channel_states (
	channel_id, name, type, newapi_status, models_json, test_model, group_name,
	auto_ban, newapi_disabled, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(channel_id) DO UPDATE SET
	name = excluded.name,
	type = excluded.type,
	newapi_status = excluded.newapi_status,
	models_json = excluded.models_json,
	test_model = excluded.test_model,
	group_name = excluded.group_name,
	auto_ban = excluded.auto_ban,
	newapi_disabled = excluded.newapi_disabled,
	updated_at = excluded.updated_at
`,
		channel.ID,
		channel.Name,
		nullString(channel.Type),
		nullString(channel.Status),
		string(models),
		nullString(channel.TestModel),
		group,
		autoBan,
		boolInt(channel.DisabledInNewAPI()),
	)
	return err
}

func (s *Store) RuntimeState(ctx context.Context, channelID int64) (core.RuntimeState, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT channel_id, watchdog_status, consecutive_failures, consecutive_successes,
	auto_disabled_by_watchdog, COALESCE(last_error, ''), COALESCE(last_latency_ms, 0),
	COALESCE(last_http_status, 0), COALESCE(last_probe_at, '')
FROM channel_states
WHERE channel_id = ?
`, channelID)
	var state core.RuntimeState
	var status string
	var autoDisabled int
	if err := row.Scan(
		&state.ChannelID,
		&status,
		&state.ConsecutiveFailures,
		&state.ConsecutiveSuccesses,
		&autoDisabled,
		&state.LastError,
		&state.LastLatencyMS,
		&state.LastHTTPStatus,
		&state.LastProbeAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return core.RuntimeState{ChannelID: channelID, Status: core.StatusUnknown}, nil
		}
		return state, err
	}
	state.Status = core.ChannelStatus(status)
	state.AutoDisabledByWatchdog = autoDisabled == 1
	return state, nil
}

type ProbeStats struct {
	Total    int
	Failures int
}

func (s *Store) RecentProbeStats(ctx context.Context, channelID int64, window time.Duration) (ProbeStats, error) {
	since := time.Now().UTC().Add(-window).Format("2006-01-02T15:04:05.000Z")
	row := s.db.QueryRowContext(ctx, `
SELECT COUNT(*), COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0)
FROM probe_events
WHERE channel_id = ? AND created_at >= ?
`, channelID, since)
	var stats ProbeStats
	if err := row.Scan(&stats.Total, &stats.Failures); err != nil {
		return stats, err
	}
	return stats, nil
}

type StateUpdate struct {
	ChannelID              int64
	Status                 core.ChannelStatus
	ConsecutiveFailures    int
	ConsecutiveSuccesses   int
	AutoDisabledSet        bool
	AutoDisabledByWatchdog bool
	LastError              string
	LastLatencyMS          int64
	LastHTTPStatus         int
	RecordProbeTime        bool
}

func (s *Store) SetChannelState(ctx context.Context, update StateUpdate) error {
	clauses := []string{
		"watchdog_status = ?",
		"consecutive_failures = ?",
		"consecutive_successes = ?",
		"last_error = ?",
		"last_latency_ms = ?",
		"last_http_status = ?",
		"updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
	}
	args := []any{
		string(update.Status),
		update.ConsecutiveFailures,
		update.ConsecutiveSuccesses,
		nullString(update.LastError),
		nullableInt64(update.LastLatencyMS),
		nullableInt(update.LastHTTPStatus),
	}
	if update.AutoDisabledSet {
		clauses = append(clauses, "auto_disabled_by_watchdog = ?")
		args = append(args, boolInt(update.AutoDisabledByWatchdog))
	}
	if update.RecordProbeTime {
		clauses = append(clauses, "last_probe_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
		if update.LastError != "" {
			clauses = append(clauses, "last_failure_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
		} else {
			clauses = append(clauses, "last_success_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
		}
	}
	args = append(args, update.ChannelID)
	query := fmt.Sprintf("UPDATE channel_states SET %s WHERE channel_id = ?", strings.Join(clauses, ", "))
	_, err := s.db.ExecContext(ctx, query, args...)
	return err
}

func (s *Store) InsertProbeEvent(ctx context.Context, runID string, result core.ProbeResult) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO probe_events (
	run_id, channel_id, model, ok, latency_ms, error_class, error_message, http_status, response_excerpt
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		runID,
		result.ChannelID,
		nullString(result.Model),
		boolInt(result.OK),
		result.LatencyMS,
		string(result.ErrorClass),
		nullString(result.ErrorMessage),
		nullableInt(result.HTTPStatus),
		nullString(result.ResponseExcerpt),
	)
	return err
}

func (s *Store) InsertStatusEvent(ctx context.Context, event StatusEvent) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO status_events (
	channel_id, previous_status, current_status, reason, action, dry_run
) VALUES (?, ?, ?, ?, ?, ?)
`,
		event.ChannelID,
		nullString(event.PreviousStatus),
		event.CurrentStatus,
		nullString(event.Reason),
		nullString(event.Action),
		boolInt(event.DryRun),
	)
	return err
}

func (s *Store) StartRun(ctx context.Context, runID string) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO watchdog_runs (id) VALUES (?)", runID)
	return err
}

func (s *Store) FinishRun(ctx context.Context, run RunView) error {
	_, err := s.db.ExecContext(ctx, `
UPDATE watchdog_runs
SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
	status = ?,
	channels_seen = ?,
	probes_total = ?,
	probes_ok = ?,
	probes_failed = ?,
	actions_taken = ?,
	error = ?
WHERE id = ?
`,
		run.Status,
		run.ChannelsSeen,
		run.ProbesTotal,
		run.ProbesOK,
		run.ProbesFailed,
		run.ActionsTaken,
		nullString(run.Error),
		run.ID,
	)
	return err
}

func (s *Store) LatestChannels(ctx context.Context) ([]ChannelView, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT *,
	(SELECT COUNT(*) FROM probe_events p
	 WHERE p.channel_id = channel_states.channel_id
	   AND p.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) AS probes_1h,
	(SELECT COUNT(*) FROM probe_events p
	 WHERE p.channel_id = channel_states.channel_id
	   AND p.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') AND p.ok = 1) AS ok_1h,
	(SELECT COUNT(*) FROM probe_events p
	 WHERE p.channel_id = channel_states.channel_id
	   AND p.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hour')) AS probes_24h,
	(SELECT COUNT(*) FROM probe_events p
	 WHERE p.channel_id = channel_states.channel_id
	   AND p.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hour') AND p.ok = 1) AS ok_24h
FROM channel_states
ORDER BY group_name, name, channel_id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	channels := []ChannelView{}
	for rows.Next() {
		channel, err := scanChannelView(rows)
		if err != nil {
			return nil, err
		}
		channels = append(channels, channel)
	}
	return channels, rows.Err()
}

func (s *Store) LatestModels(ctx context.Context) ([]ModelView, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT m.model, m.group_name, m.total_channels, m.healthy, m.degraded, m.down,
	m.auto_disabled, m.manually_disabled, m.avg_latency_ms, m.success_rate_1h,
	m.success_rate_24h, m.snapshot_at
FROM model_health_snapshots m
INNER JOIN (
	SELECT model, group_name, MAX(snapshot_at) AS snapshot_at
	FROM model_health_snapshots
	GROUP BY model, group_name
) latest
  ON latest.model = m.model
 AND latest.group_name = m.group_name
 AND latest.snapshot_at = m.snapshot_at
ORDER BY m.group_name, m.model
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	models := []ModelView{}
	for rows.Next() {
		var model ModelView
		var avg, rate1, rate24 sql.NullFloat64
		if err := rows.Scan(
			&model.Model,
			&model.GroupName,
			&model.TotalChannels,
			&model.Healthy,
			&model.Degraded,
			&model.Down,
			&model.AutoDisabled,
			&model.ManuallyDisabled,
			&avg,
			&rate1,
			&rate24,
			&model.SnapshotAt,
		); err != nil {
			return nil, err
		}
		model.AvgLatencyMS = nullFloatPtr(avg)
		model.SuccessRate1h = nullFloatPtr(rate1)
		model.SuccessRate24h = nullFloatPtr(rate24)
		models = append(models, model)
	}
	return models, rows.Err()
}

func (s *Store) RecentEvents(ctx context.Context, limit int, channelID *int64) ([]StatusEvent, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}
	query := `
SELECT id, channel_id, COALESCE(previous_status, ''), current_status, COALESCE(reason, ''),
	COALESCE(action, ''), dry_run, created_at
FROM status_events
`
	args := []any{}
	if channelID != nil {
		query += "WHERE channel_id = ?\n"
		args = append(args, *channelID)
	}
	query += "ORDER BY id DESC LIMIT ?"
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []StatusEvent{}
	for rows.Next() {
		var event StatusEvent
		var channel sql.NullInt64
		var dryRun int
		if err := rows.Scan(
			&event.ID,
			&channel,
			&event.PreviousStatus,
			&event.CurrentStatus,
			&event.Reason,
			&event.Action,
			&dryRun,
			&event.CreatedAt,
		); err != nil {
			return nil, err
		}
		if channel.Valid {
			event.ChannelID = &channel.Int64
		}
		event.DryRun = dryRun == 1
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) RecentRuns(ctx context.Context, limit int) ([]RunView, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, started_at, COALESCE(finished_at, ''), status, channels_seen,
	probes_total, probes_ok, probes_failed, actions_taken, COALESCE(error, '')
FROM watchdog_runs
ORDER BY started_at DESC
LIMIT ?
`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	runs := []RunView{}
	for rows.Next() {
		var run RunView
		if err := rows.Scan(
			&run.ID,
			&run.StartedAt,
			&run.FinishedAt,
			&run.Status,
			&run.ChannelsSeen,
			&run.ProbesTotal,
			&run.ProbesOK,
			&run.ProbesFailed,
			&run.ActionsTaken,
			&run.Error,
		); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) Snapshot(ctx context.Context, dryRun bool, newAPIBaseURL string) (StatusSnapshot, error) {
	channels, err := s.LatestChannels(ctx)
	if err != nil {
		return StatusSnapshot{}, err
	}
	models, err := s.LatestModels(ctx)
	if err != nil {
		return StatusSnapshot{}, err
	}
	events, err := s.RecentEvents(ctx, 50, nil)
	if err != nil {
		return StatusSnapshot{}, err
	}
	runs, err := s.RecentRuns(ctx, 5)
	if err != nil {
		return StatusSnapshot{}, err
	}
	counts := map[string]int{
		string(core.StatusUnknown):          0,
		string(core.StatusHealthy):          0,
		string(core.StatusDegraded):         0,
		string(core.StatusDown):             0,
		string(core.StatusAutoDisabled):     0,
		string(core.StatusManuallyDisabled): 0,
		string(core.StatusRecovering):       0,
	}
	for _, channel := range channels {
		counts[string(channel.WatchdogStatus)]++
	}
	return StatusSnapshot{
		Summary: StatusSummary{
			TotalChannels: len(channels),
			Counts:        counts,
		},
		Channels:      channels,
		Models:        models,
		Events:        events,
		Runs:          runs,
		DryRun:        dryRun,
		NewAPIBaseURL: newAPIBaseURL,
	}, nil
}

func (s *Store) RebuildModelSnapshots(ctx context.Context) error {
	channels, err := s.LatestChannels(ctx)
	if err != nil {
		return err
	}
	type bucket struct {
		channels []ChannelView
	}
	buckets := map[string]bucket{}
	for _, channel := range channels {
		models := channel.Models
		if len(models) == 0 && channel.TestModel != "" {
			models = []string{channel.TestModel}
		}
		for _, model := range models {
			key := model + "\x00" + channel.GroupName
			item := buckets[key]
			item.channels = append(item.channels, channel)
			buckets[key] = item
		}
	}
	for key, bucket := range buckets {
		parts := strings.SplitN(key, "\x00", 2)
		model, group := parts[0], parts[1]
		counts := map[core.ChannelStatus]int{}
		var latencySum float64
		var latencyCount int
		var rate1Sum float64
		var rate1Count int
		var rate24Sum float64
		var rate24Count int
		for _, channel := range bucket.channels {
			counts[channel.WatchdogStatus]++
			if channel.LastLatencyMS != nil {
				latencySum += float64(*channel.LastLatencyMS)
				latencyCount++
			}
			if channel.SuccessRate1h != nil {
				rate1Sum += *channel.SuccessRate1h
				rate1Count++
			}
			if channel.SuccessRate24h != nil {
				rate24Sum += *channel.SuccessRate24h
				rate24Count++
			}
		}
		_, err := s.db.ExecContext(ctx, `
INSERT INTO model_health_snapshots (
	model, group_name, total_channels, healthy, degraded, down,
	auto_disabled, manually_disabled, avg_latency_ms, success_rate_1h, success_rate_24h
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
			model,
			group,
			len(bucket.channels),
			counts[core.StatusHealthy],
			counts[core.StatusDegraded],
			counts[core.StatusDown],
			counts[core.StatusAutoDisabled],
			counts[core.StatusManuallyDisabled],
			avgOrNil(latencySum, latencyCount),
			avgOrNil(rate1Sum, rate1Count),
			avgOrNil(rate24Sum, rate24Count),
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func scanChannelView(rows *sql.Rows) (ChannelView, error) {
	var channel ChannelView
	var watchdogStatus string
	var modelsJSON string
	var autoBan sql.NullInt64
	var channelType, newAPIStatus, testModel sql.NullString
	var newAPIDisabled, autoDisabled int
	var lastProbe, lastSuccess, lastFailure, lastError sql.NullString
	var lastLatency sql.NullInt64
	var lastHTTP sql.NullInt64
	var probes1h, ok1h, probes24h, ok24h int
	var createdAt, updatedAt string
	err := rows.Scan(
		&channel.ChannelID,
		&channel.Name,
		&channelType,
		&newAPIStatus,
		&watchdogStatus,
		&modelsJSON,
		&testModel,
		&channel.GroupName,
		&autoBan,
		&newAPIDisabled,
		&autoDisabled,
		&channel.ConsecutiveFailures,
		&channel.ConsecutiveSuccesses,
		&lastProbe,
		&lastSuccess,
		&lastFailure,
		&lastError,
		&lastLatency,
		&lastHTTP,
		&createdAt,
		&updatedAt,
		&probes1h,
		&ok1h,
		&probes24h,
		&ok24h,
	)
	if err != nil {
		return channel, err
	}
	channel.Type = nullStringValue(channelType)
	channel.NewAPIStatus = nullStringValue(newAPIStatus)
	channel.TestModel = nullStringValue(testModel)
	channel.WatchdogStatus = core.ChannelStatus(watchdogStatus)
	channel.WatchdogEnabled = true
	_ = json.Unmarshal([]byte(modelsJSON), &channel.Models)
	if autoBan.Valid {
		value := autoBan.Int64 == 1
		channel.AutoBan = &value
	}
	channel.NewAPIDisabled = newAPIDisabled == 1
	channel.AutoDisabledByWatchdog = autoDisabled == 1
	channel.LastProbeAt = nullStringValue(lastProbe)
	channel.LastSuccessAt = nullStringValue(lastSuccess)
	channel.LastFailureAt = nullStringValue(lastFailure)
	channel.LastError = nullStringValue(lastError)
	if lastLatency.Valid {
		channel.LastLatencyMS = &lastLatency.Int64
	}
	if lastHTTP.Valid {
		value := int(lastHTTP.Int64)
		channel.LastHTTPStatus = &value
	}
	channel.SuccessRate1h = ratio(ok1h, probes1h)
	channel.SuccessRate24h = ratio(ok24h, probes24h)
	return channel, nil
}

func sqliteDSN(path string) string {
	if path == ":memory:" || strings.HasPrefix(path, "file:") {
		return appendDSNOptions(path)
	}
	return appendDSNOptions(filepath.ToSlash(path))
}

func appendDSNOptions(path string) string {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	return path + sep + "_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)"
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullableBool(value *bool) any {
	if value == nil {
		return nil
	}
	return boolInt(*value)
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableInt(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func nullableInt64(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func ratio(ok, total int) *float64 {
	if total <= 0 {
		return nil
	}
	value := math.Round((float64(ok)/float64(total))*10000) / 10000
	return &value
}

func avgOrNil(sum float64, count int) any {
	if count == 0 {
		return nil
	}
	return sum / float64(count)
}

func nullFloatPtr(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}
