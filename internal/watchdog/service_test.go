package watchdog

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/config"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/core"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/store"
)

type fakeClient struct {
	channels []core.ChannelInfo
	results  map[int64]core.ProbeResult
	disable  int
	enable   int
}

func (f *fakeClient) DiscoverChannels(ctx context.Context) ([]core.ChannelInfo, error) {
	return f.channels, nil
}

func (f *fakeClient) ProbeChannel(ctx context.Context, channel core.ChannelInfo, model string) (core.ProbeResult, error) {
	result := f.results[channel.ID]
	result.Model = model
	return result, nil
}

func (f *fakeClient) DisableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error) {
	f.disable++
	return core.ActionResult{OK: true, Action: "disable", DryRun: dryRun, Message: "disabled"}, nil
}

func (f *fakeClient) EnableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error) {
	f.enable++
	return core.ActionResult{OK: true, Action: "enable", DryRun: dryRun, Message: "enabled"}, nil
}

func (f *fakeClient) UpdateConfig(cfg config.Config) {}

func TestRunOnceSkipsManualDisabled(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	cfg.Policy.DryRun = false
	cfg.Policy.FailureThreshold = 1
	st := newWatchdogStore(t)
	defer st.Close()
	client := &fakeClient{
		channels: []core.ChannelInfo{{ID: 1, Name: "manual", Status: "2"}},
		results: map[int64]core.ProbeResult{
			1: {ChannelID: 1, OK: true, LatencyMS: 20, ErrorClass: core.ErrorNone},
		},
	}
	service := New(cfg, st, client)
	result, err := service.RunOnce(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.ProbesTotal != 0 {
		t.Fatalf("manual disabled channel should not be probed, got %d probes", result.ProbesTotal)
	}
	if client.enable != 0 {
		t.Fatal("manual disabled channel must not be auto-enabled")
	}
	channels, err := st.LatestChannels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if channels[0].WatchdogStatus != core.StatusManuallyDisabled {
		t.Fatalf("expected manually_disabled, got %s", channels[0].WatchdogStatus)
	}
}

func TestRunOnceAutoDisableAndRecover(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	cfg.Policy.DryRun = false
	cfg.Policy.FailureThreshold = 1
	cfg.Policy.RecoveryThreshold = 1
	st := newWatchdogStore(t)
	defer st.Close()
	client := &fakeClient{
		channels: []core.ChannelInfo{{ID: 2, Name: "auto", Status: "1"}},
		results: map[int64]core.ProbeResult{
			2: {
				ChannelID:    2,
				OK:           false,
				LatencyMS:    30,
				ErrorClass:   core.ErrorFatal,
				ErrorMessage: "invalid api key",
				HTTPStatus:   401,
			},
		},
	}
	service := New(cfg, st, client)
	if _, err := service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if client.disable != 1 {
		t.Fatalf("expected one disable action, got %d", client.disable)
	}
	state, err := st.RuntimeState(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != core.StatusAutoDisabled || !state.AutoDisabledByWatchdog {
		t.Fatalf("expected auto disabled state, got %#v", state)
	}

	client.channels[0].Status = "2"
	client.results[2] = core.ProbeResult{ChannelID: 2, OK: true, LatencyMS: 20, ErrorClass: core.ErrorNone}
	if _, err := service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if client.enable != 1 {
		t.Fatalf("expected one enable action, got %d", client.enable)
	}
	state, err = st.RuntimeState(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != core.StatusHealthy || state.AutoDisabledByWatchdog {
		t.Fatalf("expected recovered healthy state, got %#v", state)
	}
}

func newWatchdogStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "watchdog.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	return st
}
