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
	models   []string
	discover int
	probe    int
	disable  int
	enable   int
}

func (f *fakeClient) DiscoverChannels(ctx context.Context) ([]core.ChannelInfo, error) {
	f.discover++
	return f.channels, nil
}

func (f *fakeClient) ProbeChannel(ctx context.Context, channel core.ChannelInfo, model string) (core.ProbeResult, error) {
	f.probe++
	f.models = append(f.models, model)
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
	cfg.Probe.PerChannel["1"] = config.ProbeTarget{Models: []string{"test-model"}}
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
	cfg.Policy.RecoveryWaitSeconds = 0
	cfg.Probe.PerChannel["2"] = config.ProbeTarget{Models: []string{"test-model"}}
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

func TestDiscoverOnlyDoesNotProbeChannels(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	st := newWatchdogStore(t)
	defer st.Close()
	client := &fakeClient{
		channels: []core.ChannelInfo{{ID: 3, Name: "discovered", Status: "1"}},
		results: map[int64]core.ProbeResult{
			3: {ChannelID: 3, OK: true, LatencyMS: 20, ErrorClass: core.ErrorNone},
		},
	}
	service := New(cfg, st, client)
	result, err := service.DiscoverOnly(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.ChannelsSeen != 1 || result.ProbesTotal != 0 || client.probe != 0 {
		t.Fatalf("discover-only should not probe channels: result=%#v probes=%d", result, client.probe)
	}
	channels, err := st.LatestChannels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(channels) != 1 || channels[0].ChannelID != 3 {
		t.Fatalf("expected discovered channel to be stored, got %#v", channels)
	}
}

func TestProbeStoredChannelsDoesNotDiscover(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	cfg.Probe.PerChannel["8"] = config.ProbeTarget{Models: []string{"saved-model"}}
	st := newWatchdogStore(t)
	defer st.Close()
	if err := st.UpsertChannel(ctx, core.ChannelInfo{ID: 8, Name: "stored", Status: "1", Models: []string{"saved-model"}}); err != nil {
		t.Fatal(err)
	}
	client := &fakeClient{
		results: map[int64]core.ProbeResult{
			8: {ChannelID: 8, OK: true, LatencyMS: 20, ErrorClass: core.ErrorNone},
		},
	}
	service := New(cfg, st, client)
	result, err := service.ProbeStoredChannels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.ChannelsSeen != 1 || result.ProbesTotal != 1 || client.discover != 0 || client.probe != 1 {
		t.Fatalf("expected stored-channel probe without discovery: result=%#v discover=%d probe=%d", result, client.discover, client.probe)
	}
	if len(client.models) != 1 || client.models[0] != "saved-model" {
		t.Fatalf("unexpected probed models: %#v", client.models)
	}
}

func TestManualActionsKeepExplicitStatusInDryRun(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	cfg.Policy.DryRun = true
	st := newWatchdogStore(t)
	defer st.Close()
	client := &fakeClient{
		channels: []core.ChannelInfo{{ID: 7, Name: "manual-action", Status: "1"}},
	}
	service := New(cfg, st, client)

	if _, err := service.ManualDisable(ctx, 7); err != nil {
		t.Fatal(err)
	}
	state, err := st.RuntimeState(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != core.StatusManuallyDisabled {
		t.Fatalf("expected dry-run manual disable to keep explicit status, got %s", state.Status)
	}

	if _, err := service.ManualEnable(ctx, 7); err != nil {
		t.Fatal(err)
	}
	state, err = st.RuntimeState(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != core.StatusRecovering {
		t.Fatalf("expected dry-run manual enable to keep explicit status, got %s", state.Status)
	}
}

func TestRunOnceSkipsChannelWhenProbeDisabled(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	disabled := false
	cfg.Probe.PerChannel = map[string]config.ProbeTarget{
		"4": {Enabled: &disabled},
	}
	st := newWatchdogStore(t)
	defer st.Close()
	client := &fakeClient{
		channels: []core.ChannelInfo{{ID: 4, Name: "skipped", Status: "1"}},
		results: map[int64]core.ProbeResult{
			4: {ChannelID: 4, OK: true, LatencyMS: 20, ErrorClass: core.ErrorNone},
		},
	}
	service := New(cfg, st, client)
	result, err := service.RunOnce(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.ChannelsSeen != 1 || result.ProbesTotal != 0 || client.probe != 0 {
		t.Fatalf("disabled channel should be discovered but not probed: result=%#v probes=%d", result, client.probe)
	}
}

func TestProbeChannelWithUpstreamModels(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	st := newWatchdogStore(t)
	defer st.Close()
	client := &fakeClient{
		channels: []core.ChannelInfo{{ID: 6, Name: "upstream", Status: "1", Models: []string{"gpt-4o", "claude-sonnet"}}},
		results: map[int64]core.ProbeResult{
			6: {ChannelID: 6, OK: true, LatencyMS: 20, ErrorClass: core.ErrorNone},
		},
	}
	service := New(cfg, st, client)
	result, err := service.ProbeChannelWithModel(ctx, 6, "", true)
	if err != nil {
		t.Fatal(err)
	}
	if result.ProbesTotal != 2 || client.probe != 2 {
		t.Fatalf("expected two upstream model probes, result=%#v probes=%d", result, client.probe)
	}
	if len(client.models) != 2 || client.models[0] != "gpt-4o" || client.models[1] != "claude-sonnet" {
		t.Fatalf("unexpected probed models: %#v", client.models)
	}
}

func TestRunOnceCircuitBreaksByErrorRate(t *testing.T) {
	ctx := context.Background()
	cfg := config.Default()
	cfg.Policy.DryRun = false
	cfg.Policy.FailureThreshold = 100
	cfg.Policy.ErrorRateThreshold = 50
	cfg.Policy.ErrorRateMinRequests = 2
	cfg.Probe.PerChannel["5"] = config.ProbeTarget{Models: []string{"test-model"}}
	st := newWatchdogStore(t)
	defer st.Close()
	client := &fakeClient{
		channels: []core.ChannelInfo{{ID: 5, Name: "rate", Status: "1"}},
		results: map[int64]core.ProbeResult{
			5: {ChannelID: 5, OK: false, LatencyMS: 20, ErrorClass: core.ErrorTransient, ErrorMessage: "timeout"},
		},
	}
	service := New(cfg, st, client)
	if _, err := service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if client.disable != 0 {
		t.Fatalf("first failure should not satisfy minimum request count, disable=%d", client.disable)
	}
	if _, err := service.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if client.disable != 1 {
		t.Fatalf("expected error-rate circuit breaker to disable once, got %d", client.disable)
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
