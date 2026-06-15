package core

type ChannelStatus string

const (
	StatusUnknown          ChannelStatus = "unknown"
	StatusHealthy          ChannelStatus = "healthy"
	StatusDegraded         ChannelStatus = "degraded"
	StatusDown             ChannelStatus = "down"
	StatusAutoDisabled     ChannelStatus = "auto_disabled"
	StatusManuallyDisabled ChannelStatus = "manually_disabled"
	StatusRecovering       ChannelStatus = "recovering"
)

type ErrorClass string

const (
	ErrorNone      ErrorClass = "none"
	ErrorTransient ErrorClass = "transient"
	ErrorFatal     ErrorClass = "fatal"
	ErrorUnknown   ErrorClass = "unknown"
)

type ChannelInfo struct {
	ID        int64
	Name      string
	Type      string
	Status    string
	Models    []string
	TestModel string
	Group     string
	AutoBan   *bool
}

func (c ChannelInfo) EffectiveGroup() string {
	if c.Group == "" {
		return "default"
	}
	return c.Group
}

func (c ChannelInfo) DisabledInNewAPI() bool {
	switch normalizeStatus(c.Status) {
	case "0", "2", "disabled", "disable", "inactive", "off", "ban", "banned", "false":
		return true
	default:
		return false
	}
}

type ProbeResult struct {
	ChannelID       int64      `json:"channel_id"`
	Model           string     `json:"model,omitempty"`
	OK              bool       `json:"ok"`
	LatencyMS       int64      `json:"latency_ms"`
	ErrorClass      ErrorClass `json:"error_class"`
	ErrorMessage    string     `json:"error_message,omitempty"`
	HTTPStatus      int        `json:"http_status,omitempty"`
	ResponseExcerpt string     `json:"response_excerpt,omitempty"`
}

type RuntimeState struct {
	ChannelID              int64
	Status                 ChannelStatus
	ConsecutiveFailures    int
	ConsecutiveSuccesses   int
	AutoDisabledByWatchdog bool
	LastProbeAt            string
	LastError              string
	LastLatencyMS          int64
	LastHTTPStatus         int
}

type PolicyRules struct {
	FailureThreshold         int
	RecoveryThreshold        int
	RecoveryWaitSeconds      int
	DegradedFailureThreshold int
	SlowLatencyMS            int64
	ErrorRateThreshold       float64
	ErrorRateMinRequests     int
	AutoDisable              bool
	AutoRecover              bool
	RespectChannelAutoBan    bool
	TransientErrorPatterns   []string
	FatalErrorPatterns       []string
}

type PolicyDecision struct {
	Status               ChannelStatus
	Reason               string
	ConsecutiveFailures  int
	ConsecutiveSuccesses int
	ShouldDisable        bool
	ShouldEnable         bool
}

type ActionResult struct {
	OK      bool   `json:"ok"`
	Action  string `json:"action"`
	DryRun  bool   `json:"dry_run"`
	Message string `json:"message,omitempty"`
}
