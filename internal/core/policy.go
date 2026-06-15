package core

import (
	"fmt"
	"strconv"
	"strings"
)

func DefaultPolicyRules() PolicyRules {
	return PolicyRules{
		FailureThreshold:         3,
		RecoveryThreshold:        2,
		DegradedFailureThreshold: 1,
		SlowLatencyMS:            5000,
		AutoDisable:              true,
		AutoRecover:              true,
		RespectChannelAutoBan:    true,
		TransientErrorPatterns: []string{
			"timeout", "timed out", "connection", "temporarily", "rate limit",
			"429", "502", "503", "504",
		},
		FatalErrorPatterns: []string{
			"invalid api key", "incorrect api key", "unauthorized", "forbidden",
			"quota", "insufficient", "billing", "permission", "401", "403",
		},
	}
}

func ClassifyError(message string, httpStatus int, rules PolicyRules) ErrorClass {
	if message == "" && httpStatus == 0 {
		return ErrorNone
	}
	text := strings.ToLower(fmt.Sprintf("%d %s", httpStatus, message))
	for _, pattern := range rules.FatalErrorPatterns {
		if strings.Contains(text, strings.ToLower(pattern)) {
			return ErrorFatal
		}
	}
	for _, pattern := range rules.TransientErrorPatterns {
		if strings.Contains(text, strings.ToLower(pattern)) {
			return ErrorTransient
		}
	}
	if httpStatus >= 500 {
		return ErrorTransient
	}
	if httpStatus == 401 || httpStatus == 403 {
		return ErrorFatal
	}
	return ErrorUnknown
}

func EvaluateProbe(channel ChannelInfo, state RuntimeState, result *ProbeResult, rules PolicyRules) PolicyDecision {
	if channel.DisabledInNewAPI() && !state.AutoDisabledByWatchdog {
		return PolicyDecision{
			Status:               StatusManuallyDisabled,
			Reason:               "channel is disabled in NewAPI and was not disabled by watchdog",
			ConsecutiveFailures:  state.ConsecutiveFailures,
			ConsecutiveSuccesses: 0,
		}
	}

	if result == nil {
		status := StatusUnknown
		reason := "no probe result was produced"
		if state.AutoDisabledByWatchdog {
			status = StatusAutoDisabled
			reason = "channel remains auto-disabled; no probe result was produced"
		}
		return PolicyDecision{
			Status:               status,
			Reason:               reason,
			ConsecutiveFailures:  state.ConsecutiveFailures,
			ConsecutiveSuccesses: state.ConsecutiveSuccesses,
		}
	}

	if result.OK {
		successes := state.ConsecutiveSuccesses + 1
		if state.AutoDisabledByWatchdog && rules.AutoRecover {
			return PolicyDecision{
				Status:               StatusRecovering,
				Reason:               fmt.Sprintf("auto-disabled channel has %d/%d recovery successes", successes, rules.RecoveryThreshold),
				ConsecutiveFailures:  0,
				ConsecutiveSuccesses: successes,
				ShouldEnable:         successes >= rules.RecoveryThreshold,
			}
		}
		if result.LatencyMS >= rules.SlowLatencyMS {
			return PolicyDecision{
				Status:               StatusDegraded,
				Reason:               fmt.Sprintf("probe succeeded but latency %dms is slow", result.LatencyMS),
				ConsecutiveFailures:  0,
				ConsecutiveSuccesses: successes,
			}
		}
		if state.Status == StatusDown || state.Status == StatusDegraded || state.Status == StatusRecovering {
			status := StatusRecovering
			if successes >= rules.RecoveryThreshold {
				status = StatusHealthy
			}
			return PolicyDecision{
				Status:               status,
				Reason:               fmt.Sprintf("probe succeeded with %d/%d recovery successes", successes, rules.RecoveryThreshold),
				ConsecutiveFailures:  0,
				ConsecutiveSuccesses: successes,
			}
		}
		return PolicyDecision{
			Status:               StatusHealthy,
			Reason:               "probe succeeded",
			ConsecutiveFailures:  0,
			ConsecutiveSuccesses: successes,
		}
	}

	failures := state.ConsecutiveFailures + 1
	threshold := rules.FailureThreshold
	if result.ErrorClass == ErrorFatal {
		threshold = 1
	}
	status := StatusUnknown
	if failures >= threshold {
		status = StatusDown
	} else if failures >= rules.DegradedFailureThreshold {
		status = StatusDegraded
	}
	autoBanAllowed := channel.AutoBan == nil || *channel.AutoBan || !rules.RespectChannelAutoBan
	shouldDisable := status == StatusDown && rules.AutoDisable && autoBanAllowed && !state.AutoDisabledByWatchdog
	reason := result.ErrorMessage
	if reason == "" {
		reason = "probe failed"
	}
	if result.ErrorClass == ErrorFatal {
		reason = "fatal probe failure: " + reason
	}
	return PolicyDecision{
		Status:               status,
		Reason:               reason,
		ConsecutiveFailures:  failures,
		ConsecutiveSuccesses: 0,
		ShouldDisable:        shouldDisable,
	}
}

func normalizeStatus(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return ""
	}
	if number, err := strconv.Atoi(value); err == nil {
		return strconv.Itoa(number)
	}
	return value
}
