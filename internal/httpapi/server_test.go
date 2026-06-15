package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/config"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/core"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/store"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/watchdog"
)

type apiFakeClient struct {
	channels []core.ChannelInfo
}

func (f *apiFakeClient) DiscoverChannels(ctx context.Context) ([]core.ChannelInfo, error) {
	return f.channels, nil
}

func (f *apiFakeClient) ProbeChannel(ctx context.Context, channel core.ChannelInfo, model string) (core.ProbeResult, error) {
	return core.ProbeResult{ChannelID: channel.ID, Model: model, OK: true, LatencyMS: 42, ErrorClass: core.ErrorNone, HTTPStatus: 200}, nil
}

func (f *apiFakeClient) DisableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error) {
	return core.ActionResult{OK: true, Action: "disable", DryRun: dryRun, Message: "dry-run"}, nil
}

func (f *apiFakeClient) EnableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error) {
	return core.ActionResult{OK: true, Action: "enable", DryRun: dryRun, Message: "dry-run"}, nil
}

func (f *apiFakeClient) UpdateConfig(cfg config.Config) {}

func TestServerStatusAndAuth(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	cfg.Server.AutoStart = false
	cfg.Auth.WriteToken = "secret"
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "watchdog.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	client := &apiFakeClient{channels: []core.ChannelInfo{{
		ID:        7,
		Name:      "api",
		Status:    "1",
		Models:    []string{"gpt-4o"},
		TestModel: "gpt-4o",
	}}}
	service := watchdog.New(cfg, st, client)
	server, err := New(cfg, st, service)
	if err != nil {
		t.Fatal(err)
	}
	router := server.Router()

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected healthz 200, got %d", response.Code)
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/status", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "Channel") {
		t.Fatalf("expected status page, got %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/probe/run", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized write, got %d", response.Code)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/probe/run", nil)
	req.Header.Set(cfg.Auth.WriteTokenHeader, "secret")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("expected probe run 200, got %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/status.json", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected status.json 200, got %d", response.Code)
	}
	var snapshot store.StatusSnapshot
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Summary.TotalChannels != 1 {
		t.Fatalf("expected one channel in status.json, got %d", snapshot.Summary.TotalChannels)
	}
}

func TestServerReturnsEmptyArrays(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	cfg.Server.AutoStart = false
	cfg.Auth.WriteToken = "secret"
	st, err := store.Open(ctx, filepath.Join(t.TempDir(), "watchdog.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	service := watchdog.New(cfg, st, &apiFakeClient{})
	server, err := New(cfg, st, service)
	if err != nil {
		t.Fatal(err)
	}
	router := server.Router()

	for _, path := range []string{"/api/channels", "/api/models", "/api/events", "/api/runs"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		body, _ := io.ReadAll(response.Result().Body)
		if response.Code != http.StatusOK {
			t.Fatalf("expected %s 200, got %d", path, response.Code)
		}
		if strings.TrimSpace(string(body)) != "[]" {
			t.Fatalf("expected %s to return [], got %s", path, body)
		}
	}
}
