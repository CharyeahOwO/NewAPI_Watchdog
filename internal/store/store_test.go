package store

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/core"
)

func TestStoreRecordsEventsAndSnapshots(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	defer st.Close()

	autoBan := true
	channel := core.ChannelInfo{
		ID:        10,
		Name:      "primary",
		Type:      "openai",
		Status:    "1",
		Models:    []string{"gpt-4o", "gpt-4.1"},
		TestModel: "gpt-4o",
		Group:     "default",
		AutoBan:   &autoBan,
	}
	if err := st.UpsertChannel(ctx, channel); err != nil {
		t.Fatal(err)
	}
	if err := st.InsertProbeEvent(ctx, "run-1", core.ProbeResult{
		ChannelID:  10,
		Model:      "gpt-4o",
		OK:         true,
		LatencyMS:  88,
		ErrorClass: core.ErrorNone,
		HTTPStatus: 200,
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.SetChannelState(ctx, StateUpdate{
		ChannelID:            10,
		Status:               core.StatusHealthy,
		ConsecutiveSuccesses: 1,
		LastLatencyMS:        88,
		LastHTTPStatus:       200,
		RecordProbeTime:      true,
	}); err != nil {
		t.Fatal(err)
	}
	channelID := int64(10)
	if err := st.InsertStatusEvent(ctx, StatusEvent{
		ChannelID:      &channelID,
		PreviousStatus: string(core.StatusUnknown),
		CurrentStatus:  string(core.StatusHealthy),
		Reason:         "probe succeeded",
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.RebuildModelSnapshots(ctx); err != nil {
		t.Fatal(err)
	}

	snapshot, err := st.Snapshot(ctx, true, "http://newapi:3000")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Summary.TotalChannels != 1 {
		t.Fatalf("expected one channel, got %d", snapshot.Summary.TotalChannels)
	}
	if snapshot.Summary.Counts[string(core.StatusHealthy)] != 1 {
		t.Fatalf("expected one healthy channel, got %#v", snapshot.Summary.Counts)
	}
	if len(snapshot.Models) != 2 {
		t.Fatalf("expected two model snapshots, got %d", len(snapshot.Models))
	}
	if len(snapshot.Events) != 1 {
		t.Fatalf("expected one status event, got %d", len(snapshot.Events))
	}
	if snapshot.Channels[0].SuccessRate1h == nil || *snapshot.Channels[0].SuccessRate1h != 1 {
		t.Fatalf("expected 1h success rate 1, got %#v", snapshot.Channels[0].SuccessRate1h)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "watchdog.sqlite3")
	st, err := Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	return st
}
