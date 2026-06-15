package watchdog

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/config"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/core"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/store"
)

type NewAPI interface {
	DiscoverChannels(ctx context.Context) ([]core.ChannelInfo, error)
	ProbeChannel(ctx context.Context, channel core.ChannelInfo, model string) (core.ProbeResult, error)
	DisableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error)
	EnableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error)
	UpdateConfig(cfg config.Config)
}

type Service struct {
	cfg      config.Config
	store    *store.Store
	client   NewAPI
	mu       sync.Mutex
	stop     chan struct{}
	done     chan struct{}
	loopOnce sync.Once
	stopOnce sync.Once
}

type RunResult struct {
	RunID        string `json:"run_id"`
	ChannelsSeen int    `json:"channels_seen"`
	ProbesTotal  int    `json:"probes_total"`
	ProbesOK     int    `json:"probes_ok"`
	ProbesFailed int    `json:"probes_failed"`
	ActionsTaken int    `json:"actions_taken"`
	Status       string `json:"status"`
	Error        string `json:"error,omitempty"`
}

const upstreamModelsForProbe = "__upstream_models__"

func New(cfg config.Config, store *store.Store, client NewAPI) *Service {
	return &Service{
		cfg:    cfg,
		store:  store,
		client: client,
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
}

func (s *Service) UpdateConfig(cfg config.Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	s.client.UpdateConfig(cfg)
}

func (s *Service) Start(ctx context.Context) {
	s.loopOnce.Do(func() {
		go s.loop(ctx)
	})
}

func (s *Service) Stop() {
	s.stopOnce.Do(func() {
		close(s.stop)
		<-s.done
	})
}

func (s *Service) RunOnce(ctx context.Context) (RunResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runID := newRunID()
	result := RunResult{RunID: runID, Status: "running"}
	if err := s.store.StartRun(ctx, runID); err != nil {
		return result, err
	}

	channels, err := s.client.DiscoverChannels(ctx)
	if err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		_ = s.finishRun(ctx, result)
		return result, err
	}
	result.ChannelsSeen = len(channels)

	for _, channel := range channels {
		if err := s.store.UpsertChannel(ctx, channel); err != nil {
			result.Status = "failed"
			result.Error = err.Error()
			_ = s.finishRun(ctx, result)
			return result, err
		}
		stats, err := s.processChannel(ctx, runID, channel, false, nil)
		if err != nil {
			result.Status = "failed"
			result.Error = err.Error()
			_ = s.finishRun(ctx, result)
			return result, err
		}
		result.ProbesTotal += stats.ProbesTotal
		result.ProbesOK += stats.ProbesOK
		result.ProbesFailed += stats.ProbesFailed
		result.ActionsTaken += stats.ActionsTaken
		if delay := s.cfg.Policy.PerChannelDelay(); delay > 0 {
			select {
			case <-ctx.Done():
				return result, ctx.Err()
			case <-time.After(delay):
			}
		}
	}
	if err := s.store.RebuildModelSnapshots(ctx); err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		_ = s.finishRun(ctx, result)
		return result, err
	}
	result.Status = "ok"
	if err := s.finishRun(ctx, result); err != nil {
		return result, err
	}
	return result, nil
}

func (s *Service) DiscoverOnly(ctx context.Context) (RunResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runID := newRunID()
	result := RunResult{RunID: runID, Status: "running"}
	if err := s.store.StartRun(ctx, runID); err != nil {
		return result, err
	}

	channels, err := s.client.DiscoverChannels(ctx)
	if err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		_ = s.finishRun(ctx, result)
		return result, err
	}
	result.ChannelsSeen = len(channels)

	for _, channel := range channels {
		if err := s.store.UpsertChannel(ctx, channel); err != nil {
			result.Status = "failed"
			result.Error = err.Error()
			_ = s.finishRun(ctx, result)
			return result, err
		}
	}
	if err := s.store.RebuildModelSnapshots(ctx); err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		_ = s.finishRun(ctx, result)
		return result, err
	}
	result.Status = "ok"
	return result, s.finishRun(ctx, result)
}

func (s *Service) ProbeChannel(ctx context.Context, channelID int64) (RunResult, error) {
	return s.probeChannel(ctx, channelID, nil)
}

func (s *Service) ProbeChannelWithModel(ctx context.Context, channelID int64, model string, useUpstreamModels bool) (RunResult, error) {
	var models []string
	if useUpstreamModels {
		models = []string{upstreamModelsForProbe}
	} else if model = strings.TrimSpace(model); model != "" {
		models = []string{model}
	}
	return s.probeChannel(ctx, channelID, models)
}

func (s *Service) probeChannel(ctx context.Context, channelID int64, modelOverride []string) (RunResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	channel, err := s.findChannel(ctx, channelID)
	if err != nil {
		return RunResult{}, err
	}
	if err := s.store.UpsertChannel(ctx, channel); err != nil {
		return RunResult{}, err
	}
	runID := newRunID()
	result := RunResult{RunID: runID, ChannelsSeen: 1}
	if err := s.store.StartRun(ctx, runID); err != nil {
		return result, err
	}
	if len(modelOverride) == 1 && modelOverride[0] == upstreamModelsForProbe {
		modelOverride = upstreamModels(channel)
	}
	stats, err := s.processChannel(ctx, runID, channel, true, modelOverride)
	result.ProbesTotal = stats.ProbesTotal
	result.ProbesOK = stats.ProbesOK
	result.ProbesFailed = stats.ProbesFailed
	result.ActionsTaken = stats.ActionsTaken
	if err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		_ = s.finishRun(ctx, result)
		return result, err
	}
	if err := s.store.RebuildModelSnapshots(ctx); err != nil {
		result.Status = "failed"
		result.Error = err.Error()
		_ = s.finishRun(ctx, result)
		return result, err
	}
	result.Status = "ok"
	return result, s.finishRun(ctx, result)
}

func (s *Service) ManualDisable(ctx context.Context, channelID int64) (core.ActionResult, error) {
	channel, err := s.findChannel(ctx, channelID)
	if err != nil {
		return core.ActionResult{}, err
	}
	if err := s.store.UpsertChannel(ctx, channel); err != nil {
		return core.ActionResult{}, err
	}
	result, err := s.client.DisableChannel(ctx, channel, s.cfg.Policy.DryRun)
	if err != nil {
		return result, err
	}
	status := core.StatusManuallyDisabled
	if result.DryRun {
		status = core.StatusUnknown
	}
	if err := s.store.SetChannelState(ctx, store.StateUpdate{
		ChannelID:              channelID,
		Status:                 status,
		ConsecutiveFailures:    0,
		ConsecutiveSuccesses:   0,
		AutoDisabledSet:        true,
		AutoDisabledByWatchdog: false,
	}); err != nil {
		return result, err
	}
	channelIDCopy := channelID
	_ = s.store.InsertStatusEvent(ctx, store.StatusEvent{
		ChannelID:     &channelIDCopy,
		CurrentStatus: string(status),
		Reason:        fallback(result.Message, "manual disable requested"),
		Action:        "manual_disable",
		DryRun:        result.DryRun,
	})
	return result, nil
}

func (s *Service) ManualEnable(ctx context.Context, channelID int64) (core.ActionResult, error) {
	channel, err := s.findChannel(ctx, channelID)
	if err != nil {
		return core.ActionResult{}, err
	}
	if err := s.store.UpsertChannel(ctx, channel); err != nil {
		return core.ActionResult{}, err
	}
	result, err := s.client.EnableChannel(ctx, channel, s.cfg.Policy.DryRun)
	if err != nil {
		return result, err
	}
	status := core.StatusRecovering
	if result.DryRun {
		status = core.StatusUnknown
	}
	if err := s.store.SetChannelState(ctx, store.StateUpdate{
		ChannelID:              channelID,
		Status:                 status,
		ConsecutiveFailures:    0,
		ConsecutiveSuccesses:   0,
		AutoDisabledSet:        true,
		AutoDisabledByWatchdog: false,
	}); err != nil {
		return result, err
	}
	channelIDCopy := channelID
	_ = s.store.InsertStatusEvent(ctx, store.StatusEvent{
		ChannelID:     &channelIDCopy,
		CurrentStatus: string(status),
		Reason:        fallback(result.Message, "manual enable requested"),
		Action:        "manual_enable",
		DryRun:        result.DryRun,
	})
	return result, nil
}

type channelStats struct {
	ProbesTotal  int
	ProbesOK     int
	ProbesFailed int
	ActionsTaken int
}

func (s *Service) processChannel(ctx context.Context, runID string, channel core.ChannelInfo, forceProbe bool, modelOverride []string) (channelStats, error) {
	var stats channelStats
	if !forceProbe && !s.channelProbeEnabled(channel.ID) {
		return stats, nil
	}
	state, err := s.store.RuntimeState(ctx, channel.ID)
	if err != nil {
		return stats, err
	}
	previous := state.Status
	if state.AutoDisabledByWatchdog && !forceProbe && !s.recoveryWaitElapsed(state) {
		return stats, nil
	}
	if channel.DisabledInNewAPI() && !state.AutoDisabledByWatchdog && !s.cfg.Policy.ProbeManualDisabled && !forceProbe {
		decision := core.EvaluateProbe(channel, state, nil, s.cfg.Policy.Rules())
		return stats, s.applyDecision(ctx, channel, previous, decision, nil, &stats)
	}

	results := make([]core.ProbeResult, 0)
	models := modelOverride
	if models == nil {
		models = s.modelsForProbe(channel, forceProbe)
	}
	if len(models) == 0 {
		return stats, nil
	}
	for _, model := range models {
		result, err := s.client.ProbeChannel(ctx, channel, model)
		if err != nil {
			return stats, err
		}
		if err := s.store.InsertProbeEvent(ctx, runID, result); err != nil {
			return stats, err
		}
		results = append(results, result)
		stats.ProbesTotal++
		if result.OK {
			stats.ProbesOK++
		} else {
			stats.ProbesFailed++
		}
	}
	aggregate := aggregateResults(channel.ID, results)
	decision := core.EvaluateProbe(channel, state, aggregate, s.cfg.Policy.Rules())
	var breakerErr error
	decision, breakerErr = s.applyErrorRateCircuitBreaker(ctx, channel, state, decision)
	if breakerErr != nil {
		return stats, breakerErr
	}
	return stats, s.applyDecision(ctx, channel, previous, decision, aggregate, &stats)
}

func (s *Service) applyDecision(ctx context.Context, channel core.ChannelInfo, previous core.ChannelStatus, decision core.PolicyDecision, result *core.ProbeResult, stats *channelStats) error {
	finalStatus := decision.Status
	actionName := ""
	dryRun := false
	actionMessage := ""
	autoDisabledSet := false
	autoDisabledValue := false

	if decision.ShouldDisable {
		action, err := s.client.DisableChannel(ctx, channel, s.cfg.Policy.DryRun)
		if err != nil {
			return err
		}
		stats.ActionsTaken++
		actionName = "auto_disable"
		dryRun = action.DryRun
		actionMessage = action.Message
		if action.OK && !action.DryRun {
			autoDisabledSet = true
			autoDisabledValue = true
			finalStatus = core.StatusAutoDisabled
		}
	}
	if decision.ShouldEnable {
		action, err := s.client.EnableChannel(ctx, channel, s.cfg.Policy.DryRun)
		if err != nil {
			return err
		}
		stats.ActionsTaken++
		actionName = "auto_recover"
		dryRun = action.DryRun
		actionMessage = action.Message
		if action.OK && !action.DryRun {
			autoDisabledSet = true
			autoDisabledValue = false
			finalStatus = core.StatusHealthy
		}
	}
	if finalStatus == core.StatusManuallyDisabled {
		autoDisabledSet = true
		autoDisabledValue = false
	}

	lastError := ""
	lastLatency := int64(0)
	lastHTTP := 0
	if result != nil {
		lastLatency = result.LatencyMS
		lastHTTP = result.HTTPStatus
		if !result.OK {
			lastError = result.ErrorMessage
		}
	}
	if err := s.store.SetChannelState(ctx, store.StateUpdate{
		ChannelID:              channel.ID,
		Status:                 finalStatus,
		ConsecutiveFailures:    decision.ConsecutiveFailures,
		ConsecutiveSuccesses:   decision.ConsecutiveSuccesses,
		AutoDisabledSet:        autoDisabledSet,
		AutoDisabledByWatchdog: autoDisabledValue,
		LastError:              lastError,
		LastLatencyMS:          lastLatency,
		LastHTTPStatus:         lastHTTP,
		RecordProbeTime:        result != nil,
	}); err != nil {
		return err
	}

	if previous != finalStatus || actionName != "" {
		reason := decision.Reason
		if actionMessage != "" {
			reason += "; " + actionName + ": " + actionMessage
		}
		channelID := channel.ID
		return s.store.InsertStatusEvent(ctx, store.StatusEvent{
			ChannelID:      &channelID,
			PreviousStatus: string(previous),
			CurrentStatus:  string(finalStatus),
			Reason:         reason,
			Action:         actionName,
			DryRun:         dryRun,
		})
	}
	return nil
}

func (s *Service) channelProbeEnabled(channelID int64) bool {
	if s.cfg.Probe.PerChannel == nil {
		return false
	}
	target, ok := s.cfg.Probe.PerChannel[strconv.FormatInt(channelID, 10)]
	if !ok || len(target.Models) == 0 {
		return false
	}
	if target.Enabled == nil {
		return true
	}
	return *target.Enabled
}

func (s *Service) recoveryWaitElapsed(state core.RuntimeState) bool {
	wait := time.Duration(s.cfg.Policy.RecoveryWaitSeconds) * time.Second
	if wait <= 0 || state.LastProbeAt == "" {
		return true
	}
	lastProbe, err := time.Parse(time.RFC3339Nano, state.LastProbeAt)
	if err != nil {
		return true
	}
	return time.Since(lastProbe) >= wait
}

func (s *Service) applyErrorRateCircuitBreaker(ctx context.Context, channel core.ChannelInfo, state core.RuntimeState, decision core.PolicyDecision) (core.PolicyDecision, error) {
	rules := s.cfg.Policy.Rules()
	if !rules.AutoDisable || state.AutoDisabledByWatchdog || rules.ErrorRateMinRequests <= 0 || rules.ErrorRateThreshold <= 0 {
		return decision, nil
	}
	autoBanAllowed := channel.AutoBan == nil || *channel.AutoBan || !rules.RespectChannelAutoBan
	if !autoBanAllowed {
		return decision, nil
	}
	stats, err := s.store.RecentProbeStats(ctx, channel.ID, time.Hour)
	if err != nil {
		return decision, err
	}
	if stats.Total < rules.ErrorRateMinRequests {
		return decision, nil
	}
	errorRate := float64(stats.Failures) * 100 / float64(stats.Total)
	if errorRate < rules.ErrorRateThreshold {
		return decision, nil
	}
	decision.Status = core.StatusDown
	decision.Reason = fmt.Sprintf("error rate %.1f%% reached threshold %.1f%% over %d recent probes", errorRate, rules.ErrorRateThreshold, stats.Total)
	decision.ConsecutiveFailures = maxInt(decision.ConsecutiveFailures, 1)
	decision.ConsecutiveSuccesses = 0
	decision.ShouldDisable = true
	return decision, nil
}

func (s *Service) modelsForProbe(channel core.ChannelInfo, forceProbe bool) []string {
	if target, ok := s.cfg.Probe.PerChannel[strconv.FormatInt(channel.ID, 10)]; ok {
		if target.Enabled != nil && !*target.Enabled && !forceProbe {
			return nil
		}
		if len(target.Models) > 0 {
			return target.Models
		}
		if !forceProbe {
			return nil
		}
	} else if !forceProbe {
		return nil
	}
	switch s.cfg.Probe.Mode {
	case "models":
		if len(channel.Models) > 0 {
			return channel.Models
		}
	case "test_model":
		if channel.TestModel != "" {
			return []string{channel.TestModel}
		}
	}
	return []string{""}
}

func upstreamModels(channel core.ChannelInfo) []string {
	if len(channel.Models) > 0 {
		return channel.Models
	}
	if channel.TestModel != "" {
		return []string{channel.TestModel}
	}
	return []string{""}
}

func (s *Service) findChannel(ctx context.Context, channelID int64) (core.ChannelInfo, error) {
	channels, err := s.client.DiscoverChannels(ctx)
	if err != nil {
		return core.ChannelInfo{}, err
	}
	for _, channel := range channels {
		if channel.ID == channelID {
			return channel, nil
		}
	}
	return core.ChannelInfo{}, fmt.Errorf("%w: channel %d", ErrNotFound, channelID)
}

func (s *Service) finishRun(ctx context.Context, result RunResult) error {
	return s.store.FinishRun(ctx, store.RunView{
		ID:           result.RunID,
		Status:       result.Status,
		ChannelsSeen: result.ChannelsSeen,
		ProbesTotal:  result.ProbesTotal,
		ProbesOK:     result.ProbesOK,
		ProbesFailed: result.ProbesFailed,
		ActionsTaken: result.ActionsTaken,
		Error:        result.Error,
	})
}

func (s *Service) loop(ctx context.Context) {
	defer close(s.done)
	ticker := time.NewTicker(s.cfg.Policy.Interval())
	defer ticker.Stop()
	for {
		if s.readyForAutoRun() {
			_, _ = s.RunOnce(ctx)
		}
		select {
		case <-ctx.Done():
			return
		case <-s.stop:
			return
		case <-ticker.C:
		}
	}
}

func aggregateResults(channelID int64, results []core.ProbeResult) *core.ProbeResult {
	if len(results) == 0 {
		return nil
	}
	var worst *core.ProbeResult
	for i := range results {
		result := &results[i]
		if !result.OK {
			if worst == nil || errorRank(result.ErrorClass) < errorRank(worst.ErrorClass) {
				worst = result
			}
		}
	}
	if worst != nil {
		out := *worst
		out.ChannelID = channelID
		for _, result := range results {
			if result.LatencyMS > out.LatencyMS {
				out.LatencyMS = result.LatencyMS
			}
		}
		return &out
	}
	slowest := results[0]
	for _, result := range results[1:] {
		if result.LatencyMS > slowest.LatencyMS {
			slowest = result
		}
	}
	return &slowest
}

func errorRank(class core.ErrorClass) int {
	switch class {
	case core.ErrorFatal:
		return 0
	case core.ErrorUnknown:
		return 1
	case core.ErrorTransient:
		return 2
	default:
		return 9
	}
}

func newRunID() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err == nil {
		return hex.EncodeToString(b[:])
	}
	return strconv.FormatInt(time.Now().UnixNano(), 36)
}

func fallback(value, backup string) string {
	if value != "" {
		return value
	}
	return backup
}

func (s *Service) readyForAutoRun() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg.Setup.Completed && s.cfg.NewAPI.BaseURL != "" && s.cfg.NewAPI.AdminToken != ""
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

var ErrNotFound = errors.New("not found")
