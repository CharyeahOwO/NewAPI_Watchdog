package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/config"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/httpapi"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/newapi"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/store"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/watchdog"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to bootstrap config yaml")
	runOnce := flag.Bool("run-once", false, "run one watchdog pass and exit")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.Database.SQLitePath)
	if err != nil {
		log.Fatalf("open sqlite store: %v", err)
	}
	defer st.Close()

	runtimeCfg, err := st.RuntimeConfig(ctx, cfg)
	if err != nil {
		log.Fatalf("load runtime config: %v", err)
	}
	cfg = runtimeCfg

	client := newapi.New(cfg)
	service := watchdog.New(cfg, st, client)

	if *runOnce {
		result, err := service.RunOnce(ctx)
		if err != nil {
			log.Fatalf("run once failed: %v", err)
		}
		log.Printf("run once completed: run_id=%s channels=%d probes=%d failed=%d actions=%d",
			result.RunID, result.ChannelsSeen, result.ProbesTotal, result.ProbesFailed, result.ActionsTaken)
		return
	}

	if cfg.Server.AutoStart {
		service.Start(ctx)
		defer service.Stop()
	}

	api, err := httpapi.New(cfg, st, service)
	if err != nil {
		log.Fatalf("create http api: %v", err)
	}
	address := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	server := &http.Server{
		Addr:              address,
		Handler:           api.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("newapi channel watchdog listening on http://%s", address)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server failed: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown failed: %v", err)
	}
}
