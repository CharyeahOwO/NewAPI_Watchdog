package config

import (
	"os"
	"time"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/core"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig    `json:"server" yaml:"server"`
	Auth      AuthConfig      `json:"auth" yaml:"auth"`
	Database  DatabaseConfig  `json:"database" yaml:"database"`
	Discovery DiscoveryConfig `json:"discovery" yaml:"discovery"`
	Probe     ProbeConfig     `json:"probe" yaml:"probe"`
	NewAPI    NewAPIConfig    `json:"newapi" yaml:"newapi"`
	Setup     SetupConfig     `json:"setup" yaml:"setup"`
	Policy    PolicyConfig    `json:"policy" yaml:"policy"`
}

type ServerConfig struct {
	Host      string `json:"host" yaml:"host"`
	Port      int    `json:"port" yaml:"port"`
	Title     string `json:"title" yaml:"title"`
	AutoStart bool   `json:"auto_start" yaml:"auto_start"`
}

type AuthConfig struct {
	WriteToken       string `json:"write_token" yaml:"write_token"`
	WriteTokenHeader string `json:"write_token_header" yaml:"write_token_header"`
	Username         string `json:"username" yaml:"username"`
	PasswordHash     string `json:"password_hash" yaml:"password_hash"`
}

type DatabaseConfig struct {
	SQLitePath string `json:"sqlite_path" yaml:"sqlite_path"`
}

type DiscoveryConfig struct {
	Source      string `json:"source" yaml:"source"`
	SQLitePath  string `json:"sqlite_path" yaml:"sqlite_path"`
	SQLiteQuery string `json:"sqlite_query" yaml:"sqlite_query"`
	PageSize    int    `json:"page_size" yaml:"page_size"`
}

type ProbeConfig struct {
	Mode            string                 `json:"mode" yaml:"mode"`
	ModelQueryParam string                 `json:"model_query_param" yaml:"model_query_param"`
	PerChannel      map[string]ProbeTarget `json:"per_channel" yaml:"per_channel"`
}

type ProbeTarget struct {
	Enabled *bool    `json:"enabled" yaml:"enabled"`
	Models  []string `json:"models" yaml:"models"`
}

type NewAPIConfig struct {
	BaseURL          string            `json:"base_url" yaml:"base_url"`
	AdminToken       string            `json:"admin_token" yaml:"admin_token"`
	AdminUserID      string            `json:"admin_user_id" yaml:"admin_user_id"`
	AdminTokenHeader string            `json:"admin_token_header" yaml:"admin_token_header"`
	AdminTokenPrefix string            `json:"admin_token_prefix" yaml:"admin_token_prefix"`
	TimeoutSeconds   int               `json:"timeout_seconds" yaml:"timeout_seconds"`
	VerifySSL        bool              `json:"verify_ssl" yaml:"verify_ssl"`
	Headers          map[string]string `json:"headers" yaml:"headers"`
	Endpoints        map[string]string `json:"endpoints" yaml:"endpoints"`
	EnabledStatus    int               `json:"enabled_status_value" yaml:"enabled_status_value"`
	DisabledStatus   int               `json:"disabled_status_value" yaml:"disabled_status_value"`
	DisableAction    ActionTemplate    `json:"disable_action" yaml:"disable_action"`
	EnableAction     ActionTemplate    `json:"enable_action" yaml:"enable_action"`
}

type ActionTemplate struct {
	Method            string         `json:"method" yaml:"method"`
	Path              string         `json:"path" yaml:"path"`
	Body              map[string]any `json:"body" yaml:"body"`
	FetchBeforeUpdate bool           `json:"fetch_before_update" yaml:"fetch_before_update"`
}

type SetupConfig struct {
	Completed bool `json:"completed" yaml:"completed"`
}

type PolicyConfig struct {
	IntervalSeconds          int      `json:"interval_seconds" yaml:"interval_seconds"`
	PerChannelDelaySeconds   float64  `json:"per_channel_delay_seconds" yaml:"per_channel_delay_seconds"`
	FailureThreshold         int      `json:"failure_threshold" yaml:"failure_threshold"`
	RecoveryThreshold        int      `json:"recovery_threshold" yaml:"recovery_threshold"`
	DegradedFailureThreshold int      `json:"degraded_failure_threshold" yaml:"degraded_failure_threshold"`
	SlowLatencyMS            int64    `json:"slow_latency_ms" yaml:"slow_latency_ms"`
	AutoDisable              bool     `json:"auto_disable" yaml:"auto_disable"`
	AutoRecover              bool     `json:"auto_recover" yaml:"auto_recover"`
	DryRun                   bool     `json:"dry_run" yaml:"dry_run"`
	RespectChannelAutoBan    bool     `json:"respect_channel_auto_ban" yaml:"respect_channel_auto_ban"`
	ProbeManualDisabled      bool     `json:"probe_manual_disabled" yaml:"probe_manual_disabled"`
	TransientErrorPatterns   []string `json:"transient_error_patterns" yaml:"transient_error_patterns"`
	FatalErrorPatterns       []string `json:"fatal_error_patterns" yaml:"fatal_error_patterns"`
}

func Default() Config {
	rules := core.DefaultPolicyRules()
	return Config{
		Server: ServerConfig{
			Host:      "0.0.0.0",
			Port:      8088,
			Title:     "NewAPI Channel Watchdog",
			AutoStart: true,
		},
		Auth: AuthConfig{
			WriteToken:       "change-me",
			WriteTokenHeader: "X-Watchdog-Token",
		},
		Database: DatabaseConfig{
			SQLitePath: "data/watchdog.sqlite3",
		},
		Discovery: DiscoveryConfig{
			Source:      "api",
			PageSize:    500,
			SQLiteQuery: "SELECT id, name, type, status, models, test_model, `group`, auto_ban FROM channels",
		},
		Probe: ProbeConfig{
			Mode:            "channel",
			ModelQueryParam: "model",
			PerChannel:      map[string]ProbeTarget{},
		},
	NewAPI: NewAPIConfig{
		BaseURL:          "http://newapi:3000",
		AdminTokenHeader: "Authorization",
		AdminTokenPrefix: "Bearer",
		AdminUserID:      "1",
		TimeoutSeconds:   20,
			VerifySSL:        true,
			Headers:          map[string]string{},
			Endpoints: map[string]string{
				"channel_search": "/api/channel/search",
				"channel_list":   "/api/channel/",
				"channel_detail": "/api/channel/{id}",
				"channel_test":   "/api/channel/test/{id}",
			},
			EnabledStatus:  1,
			DisabledStatus: 2,
			DisableAction: ActionTemplate{
				Method: "PUT",
				Path:   "/api/channel/",
				Body: map[string]any{
					"id":     "{id}",
					"status": "{disabled_status}",
				},
			},
			EnableAction: ActionTemplate{
				Method: "PUT",
				Path:   "/api/channel/",
				Body: map[string]any{
					"id":     "{id}",
					"status": "{enabled_status}",
				},
			},
		},
		Policy: PolicyConfig{
			IntervalSeconds:          120,
			FailureThreshold:         rules.FailureThreshold,
			RecoveryThreshold:        rules.RecoveryThreshold,
			DegradedFailureThreshold: rules.DegradedFailureThreshold,
			SlowLatencyMS:            rules.SlowLatencyMS,
			AutoDisable:              rules.AutoDisable,
			AutoRecover:              rules.AutoRecover,
			DryRun:                   true,
			RespectChannelAutoBan:    rules.RespectChannelAutoBan,
			TransientErrorPatterns:   rules.TransientErrorPatterns,
			FatalErrorPatterns:       rules.FatalErrorPatterns,
		},
	}
}

func Load(path string) (Config, error) {
	cfg := Default()
	if path != "" {
		if _, err := os.Stat(path); err == nil {
			data, err := os.ReadFile(path)
			if err != nil {
				return cfg, err
			}
			if err := yaml.Unmarshal(data, &cfg); err != nil {
				return cfg, err
			}
		}
	}
	return cfg, nil
}

func Sanitize(cfg Config) Config {
	out := cfg
	out.Auth.WriteToken = ""
	out.Auth.PasswordHash = ""
	out.NewAPI.AdminToken = ""
	return out
}

func MergeSecrets(next Config, current Config) Config {
	if next.Auth.WriteToken == "" {
		next.Auth.WriteToken = current.Auth.WriteToken
	}
	if next.Auth.Username == "" {
		next.Auth.Username = current.Auth.Username
	}
	if next.Auth.PasswordHash == "" {
		next.Auth.PasswordHash = current.Auth.PasswordHash
	}
	if next.NewAPI.AdminToken == "" {
		next.NewAPI.AdminToken = current.NewAPI.AdminToken
	}
	if next.NewAPI.AdminUserID == "" {
		next.NewAPI.AdminUserID = current.NewAPI.AdminUserID
	}
	return next
}

func (p PolicyConfig) Rules() core.PolicyRules {
	return core.PolicyRules{
		FailureThreshold:         p.FailureThreshold,
		RecoveryThreshold:        p.RecoveryThreshold,
		DegradedFailureThreshold: p.DegradedFailureThreshold,
		SlowLatencyMS:            p.SlowLatencyMS,
		AutoDisable:              p.AutoDisable,
		AutoRecover:              p.AutoRecover,
		RespectChannelAutoBan:    p.RespectChannelAutoBan,
		TransientErrorPatterns:   p.TransientErrorPatterns,
		FatalErrorPatterns:       p.FatalErrorPatterns,
	}
}

func (p PolicyConfig) Interval() time.Duration {
	return time.Duration(p.IntervalSeconds) * time.Second
}

func (p PolicyConfig) PerChannelDelay() time.Duration {
	return time.Duration(p.PerChannelDelaySeconds * float64(time.Second))
}
