package core

import "testing"

func TestEvaluateProbeFatalFailureTriggersDisable(t *testing.T) {
	channel := ChannelInfo{ID: 1, Name: "fatal", Status: "1"}
	state := RuntimeState{ChannelID: 1, Status: StatusHealthy}
	result := ProbeResult{
		ChannelID:    1,
		OK:           false,
		ErrorClass:   ErrorFatal,
		ErrorMessage: "invalid api key",
		HTTPStatus:   401,
	}
	decision := EvaluateProbe(channel, state, &result, DefaultPolicyRules())
	if decision.Status != StatusDown {
		t.Fatalf("expected down, got %s", decision.Status)
	}
	if !decision.ShouldDisable {
		t.Fatal("expected fatal failure to trigger auto-disable")
	}
	if decision.ConsecutiveFailures != 1 {
		t.Fatalf("expected one failure, got %d", decision.ConsecutiveFailures)
	}
}

func TestEvaluateProbeManualDisabledNeverAutoRecovers(t *testing.T) {
	channel := ChannelInfo{ID: 2, Name: "manual", Status: "2"}
	state := RuntimeState{ChannelID: 2, Status: StatusManuallyDisabled}
	result := ProbeResult{ChannelID: 2, OK: true, LatencyMS: 120}
	decision := EvaluateProbe(channel, state, &result, DefaultPolicyRules())
	if decision.Status != StatusManuallyDisabled {
		t.Fatalf("expected manually_disabled, got %s", decision.Status)
	}
	if decision.ShouldEnable {
		t.Fatal("manual disabled channel must not be auto-enabled")
	}
}

func TestEvaluateProbeAutoDisabledRecovery(t *testing.T) {
	channel := ChannelInfo{ID: 3, Name: "auto", Status: "2"}
	state := RuntimeState{
		ChannelID:              3,
		Status:                 StatusAutoDisabled,
		AutoDisabledByWatchdog: true,
		ConsecutiveSuccesses:   1,
	}
	result := ProbeResult{ChannelID: 3, OK: true, LatencyMS: 90}
	rules := DefaultPolicyRules()
	rules.RecoveryThreshold = 2
	decision := EvaluateProbe(channel, state, &result, rules)
	if decision.Status != StatusRecovering {
		t.Fatalf("expected recovering, got %s", decision.Status)
	}
	if !decision.ShouldEnable {
		t.Fatal("expected recovery threshold to trigger enable")
	}
}

func TestClassifyError(t *testing.T) {
	rules := DefaultPolicyRules()
	if got := ClassifyError("connection timeout", 0, rules); got != ErrorTransient {
		t.Fatalf("expected transient, got %s", got)
	}
	if got := ClassifyError("forbidden", 403, rules); got != ErrorFatal {
		t.Fatalf("expected fatal, got %s", got)
	}
}
