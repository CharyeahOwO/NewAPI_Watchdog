package httpapi

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/config"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/store"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/watchdog"
)

//go:embed webdist
var webDist embed.FS

type Server struct {
	mu      sync.RWMutex
	cfg     config.Config
	store   *store.Store
	service *watchdog.Service
	assets  http.Handler
}

type settingsResponse struct {
	Config        config.Config `json:"config"`
	HasWriteToken bool          `json:"has_write_token"`
	HasAdminToken bool          `json:"has_admin_token"`
	NeedsSetup    bool          `json:"needs_setup"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token       string `json:"token"`
	TokenHeader string `json:"token_header"`
	Username    string `json:"username"`
	Role        string `json:"role"`
	Initialized bool   `json:"initialized"`
}

type channelProbeSettingsRequest struct {
	Enabled bool `json:"enabled"`
}

func New(cfg config.Config, store *store.Store, service *watchdog.Service) (*Server, error) {
	sub, err := fs.Sub(webDist, "webdist")
	if err != nil {
		return nil, err
	}
	return &Server{
		cfg:     cfg,
		store:   store,
		service: service,
		assets:  http.FileServer(http.FS(sub)),
	}, nil
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.CleanPath)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)
	r.Get("/status.json", s.statusJSON)

	r.Route("/api", func(r chi.Router) {
		r.Get("/bootstrap", s.bootstrap)
		r.Post("/auth/login", s.login)
		r.Get("/channels", s.channels)
		r.Get("/models", s.models)
		r.Get("/events", s.events)
		r.Get("/runs", s.runs)

		r.Group(func(r chi.Router) {
			r.Use(s.requireWriteToken)
			r.Get("/settings", s.getSettings)
			r.Put("/settings", s.putSettings)
			r.Get("/rules", s.getRules)
			r.Put("/rules", s.putRules)
			r.Post("/channels/discover", s.discoverChannels)
			r.Put("/channels/{channelID}/probe-settings", s.putChannelProbeSettings)
			r.Post("/probe/run", s.runProbe)
			r.Post("/channels/{channelID}/probe", s.probeChannel)
			r.Post("/channels/{channelID}/disable", s.disableChannel)
			r.Post("/channels/{channelID}/enable", s.enableChannel)
		})
	})

	r.Get("/assets/*", s.asset)
	r.Get("/*", s.app)

	return r
}

func (s *Server) app(w http.ResponseWriter, r *http.Request) {
	index, err := webDist.ReadFile("webdist/index.html")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(index)
}

func (s *Server) asset(w http.ResponseWriter, r *http.Request) {
	http.StripPrefix("/", s.assets).ServeHTTP(w, r)
}

func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	cfg := s.currentConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"title":              cfg.Server.Title,
		"write_token_header": cfg.Auth.WriteTokenHeader,
		"dry_run":            cfg.Policy.DryRun,
		"auth_initialized":   cfg.Auth.Username != "" && cfg.Auth.PasswordHash != "",
		"username":           cfg.Auth.Username,
		"setup_completed":    cfg.Setup.Completed,
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var payload loginRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	username := strings.TrimSpace(payload.Username)
	password := payload.Password
	if username == "" || password == "" {
		writeError(w, http.StatusBadRequest, errors.New("username and password are required"))
		return
	}

	cfg := s.currentConfig()
	initialized := cfg.Auth.Username != "" && cfg.Auth.PasswordHash != ""
	if !initialized {
		passwordHash, err := hashPassword(password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		token, err := generateSessionToken()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if cfg.Auth.WriteTokenHeader == "" {
			cfg.Auth.WriteTokenHeader = "X-Watchdog-Token"
		}
		cfg.Auth.Username = username
		cfg.Auth.PasswordHash = passwordHash
		cfg.Auth.WriteToken = token
		if err := s.applyConfig(r.Context(), cfg); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, loginResponse{
			Token:       token,
			TokenHeader: cfg.Auth.WriteTokenHeader,
			Username:    username,
			Role:        "admin",
			Initialized: true,
		})
		return
	}

	if username != cfg.Auth.Username || !verifyPassword(password, cfg.Auth.PasswordHash) {
		writeError(w, http.StatusUnauthorized, errors.New("invalid username or password"))
		return
	}
	if cfg.Auth.WriteToken == "" {
		token, err := generateSessionToken()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		cfg.Auth.WriteToken = token
		if err := s.applyConfig(r.Context(), cfg); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, loginResponse{
		Token:       cfg.Auth.WriteToken,
		TokenHeader: cfg.Auth.WriteTokenHeader,
		Username:    cfg.Auth.Username,
		Role:        "admin",
		Initialized: true,
	})
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	cfg := s.currentConfig()
	if err := s.store.Health(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	if cfg.NewAPI.BaseURL == "" {
		writeError(w, http.StatusServiceUnavailable, errors.New("newapi base_url is not configured"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) statusJSON(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.snapshot(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) channels(w http.ResponseWriter, r *http.Request) {
	channels, err := s.store.LatestChannels(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.applyChannelProbeSettings(channels)
	writeJSON(w, http.StatusOK, channels)
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	models, err := s.store.LatestModels(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, models)
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	var channelID *int64
	if raw := r.URL.Query().Get("channel_id"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, errors.New("invalid channel_id"))
			return
		}
		channelID = &parsed
	}
	events, err := s.store.RecentEvents(r.Context(), limit, channelID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, events)
}

func (s *Server) runs(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	runs, err := s.store.RecentRuns(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	cfg := s.currentConfig()
	writeJSON(w, http.StatusOK, settingsResponse{
		Config:        config.Sanitize(cfg),
		HasWriteToken: cfg.Auth.WriteToken != "",
		HasAdminToken: cfg.NewAPI.AdminToken != "",
		NeedsSetup:    !cfg.Setup.Completed || cfg.Auth.Username == "" || cfg.Auth.PasswordHash == "" || cfg.NewAPI.BaseURL == "",
	})
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	current := s.currentConfig()
	next := current
	if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	next = config.MergeSecrets(next, current)
	next.Server = current.Server
	next.Database = current.Database
	if err := s.applyConfig(r.Context(), next); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, settingsResponse{
		Config:        config.Sanitize(next),
		HasWriteToken: next.Auth.WriteToken != "",
		HasAdminToken: next.NewAPI.AdminToken != "",
		NeedsSetup:    !next.Setup.Completed || next.Auth.Username == "" || next.Auth.PasswordHash == "" || next.NewAPI.BaseURL == "",
	})
}

func (s *Server) getRules(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.currentConfig().Policy)
}

func (s *Server) putRules(w http.ResponseWriter, r *http.Request) {
	next := s.currentConfig()
	if err := json.NewDecoder(r.Body).Decode(&next.Policy); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.applyConfig(r.Context(), next); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, next.Policy)
}

func (s *Server) discoverChannels(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.DiscoverOnly(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) runProbe(w http.ResponseWriter, r *http.Request) {
	result, err := s.service.RunOnce(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) putChannelProbeSettings(w http.ResponseWriter, r *http.Request) {
	channelID, ok := channelIDParam(w, r)
	if !ok {
		return
	}
	var payload channelProbeSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	next := s.currentConfig()
	if next.Probe.PerChannel == nil {
		next.Probe.PerChannel = map[string]config.ProbeTarget{}
	}
	key := strconv.FormatInt(channelID, 10)
	target := next.Probe.PerChannel[key]
	target.Enabled = &payload.Enabled
	next.Probe.PerChannel[key] = target
	if err := s.applyConfig(r.Context(), next); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	channels, err := s.store.LatestChannels(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.applyChannelProbeSettings(channels)
	for _, channel := range channels {
		if channel.ChannelID == channelID {
			writeJSON(w, http.StatusOK, channel)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"channel_id": channelID, "watchdog_enabled": payload.Enabled})
}

func (s *Server) probeChannel(w http.ResponseWriter, r *http.Request) {
	channelID, ok := channelIDParam(w, r)
	if !ok {
		return
	}
	result, err := s.service.ProbeChannel(r.Context(), channelID)
	if err != nil {
		writeError(w, statusForServiceError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) disableChannel(w http.ResponseWriter, r *http.Request) {
	channelID, ok := channelIDParam(w, r)
	if !ok {
		return
	}
	result, err := s.service.ManualDisable(r.Context(), channelID)
	if err != nil {
		writeError(w, statusForServiceError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) enableChannel(w http.ResponseWriter, r *http.Request) {
	channelID, ok := channelIDParam(w, r)
	if !ok {
		return
	}
	result, err := s.service.ManualEnable(r.Context(), channelID)
	if err != nil {
		writeError(w, statusForServiceError(err), err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) requireWriteToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg := s.currentConfig()
		expected := cfg.Auth.WriteToken
		if cfg.Auth.Username == "" || cfg.Auth.PasswordHash == "" || expected == "" {
			writeError(w, http.StatusServiceUnavailable, errors.New("admin account is not initialized"))
			return
		}
		if r.Header.Get(cfg.Auth.WriteTokenHeader) != expected {
			writeError(w, http.StatusUnauthorized, errors.New("invalid watchdog write token"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) snapshot(ctx context.Context) (store.StatusSnapshot, error) {
	cfg := s.currentConfig()
	snapshot, err := s.store.Snapshot(ctx, cfg.Policy.DryRun, cfg.NewAPI.BaseURL)
	if err != nil {
		return snapshot, err
	}
	s.applyChannelProbeSettings(snapshot.Channels)
	snapshot.GeneratedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return snapshot, nil
}

func (s *Server) currentConfig() config.Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *Server) applyConfig(ctx context.Context, cfg config.Config) error {
	if err := s.store.SaveRuntimeConfig(ctx, cfg); err != nil {
		return err
	}
	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
	s.service.UpdateConfig(cfg)
	return nil
}

func (s *Server) applyChannelProbeSettings(channels []store.ChannelView) {
	cfg := s.currentConfig()
	for index := range channels {
		channels[index].WatchdogEnabled = true
		if cfg.Probe.PerChannel == nil {
			continue
		}
		target, ok := cfg.Probe.PerChannel[strconv.FormatInt(channels[index].ChannelID, 10)]
		if ok && target.Enabled != nil {
			channels[index].WatchdogEnabled = *target.Enabled
		}
	}
}

func channelIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "channelID"), 10, 64)
	if err != nil || channelID <= 0 {
		writeError(w, http.StatusBadRequest, errors.New("invalid channel id"))
		return 0, false
	}
	return channelID, true
}

func statusForServiceError(err error) int {
	if err == nil {
		return http.StatusOK
	}
	if errors.Is(err, watchdog.ErrNotFound) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
