package newapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/newapi-tools/newapi-channel-watchdog/internal/config"
	"github.com/newapi-tools/newapi-channel-watchdog/internal/core"
	_ "modernc.org/sqlite"
)

var sensitiveKeys = map[string]struct{}{
	"key": {}, "keys": {}, "api_key": {}, "apikey": {}, "secret": {}, "token": {}, "password": {},
}

type Client struct {
	cfg        config.Config
	httpClient *http.Client
}

func New(cfg config.Config) *Client {
	timeout := time.Duration(cfg.NewAPI.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) UpdateConfig(cfg config.Config) {
	c.cfg = cfg
	timeout := time.Duration(cfg.NewAPI.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	c.httpClient.Timeout = timeout
}

func (c *Client) DiscoverChannels(ctx context.Context) ([]core.ChannelInfo, error) {
	switch strings.ToLower(c.cfg.Discovery.Source) {
	case "sqlite":
		return c.discoverFromSQLite(ctx)
	case "api_then_sqlite":
		channels, err := c.discoverFromAPI(ctx)
		if err == nil && len(channels) > 0 {
			return channels, nil
		}
		return c.discoverFromSQLite(ctx)
	default:
		return c.discoverFromAPI(ctx)
	}
}

func (c *Client) ProbeChannel(ctx context.Context, channel core.ChannelInfo, model string) (core.ProbeResult, error) {
	endpoint := c.endpoint("channel_test", "/api/channel/test/{id}")
	endpoint = strings.ReplaceAll(endpoint, "{id}", strconv.FormatInt(channel.ID, 10))
	values := url.Values{}
	if model != "" {
		values.Set(c.cfg.Probe.ModelQueryParam, model)
	}
	started := time.Now()
	payload, statusCode, body, err := c.requestJSON(ctx, http.MethodGet, endpoint, values, nil)
	latency := time.Since(started).Milliseconds()
	if err != nil {
		errClass := core.ClassifyError(err.Error(), statusCode, c.cfg.Policy.Rules())
		return core.ProbeResult{
			ChannelID:       channel.ID,
			Model:           model,
			OK:              false,
			LatencyMS:       latency,
			ErrorClass:      errClass,
			ErrorMessage:    err.Error(),
			HTTPStatus:      statusCode,
			ResponseExcerpt: excerpt(body),
		}, nil
	}
	ok, message := successfulTest(payload, statusCode, body)
	result := core.ProbeResult{
		ChannelID:       channel.ID,
		Model:           model,
		OK:              ok,
		LatencyMS:       latency,
		ErrorClass:      core.ErrorNone,
		HTTPStatus:      statusCode,
		ResponseExcerpt: excerpt(body),
	}
	if !ok {
		result.ErrorMessage = message
		result.ErrorClass = core.ClassifyError(message, statusCode, c.cfg.Policy.Rules())
	}
	return result, nil
}

func (c *Client) DisableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error) {
	return c.runAction(ctx, "disable", channel, c.cfg.NewAPI.DisableAction, c.cfg.NewAPI.DisabledStatus, dryRun)
}

func (c *Client) EnableChannel(ctx context.Context, channel core.ChannelInfo, dryRun bool) (core.ActionResult, error) {
	return c.runAction(ctx, "enable", channel, c.cfg.NewAPI.EnableAction, c.cfg.NewAPI.EnabledStatus, dryRun)
}

func (c *Client) discoverFromAPI(ctx context.Context) ([]core.ChannelInfo, error) {
	candidates := []struct {
		key    string
		path   string
		values url.Values
	}{
		{"channel_search", "/api/channel/search", url.Values{}},
		{"channel_list", "/api/channel/", url.Values{"p": []string{"0"}, "page_size": []string{strconv.Itoa(c.cfg.Discovery.PageSize)}}},
		{"channel_list", "/api/channel/", url.Values{"p": []string{"1"}, "page_size": []string{strconv.Itoa(c.cfg.Discovery.PageSize)}}},
	}
	var lastErr error
	for _, candidate := range candidates {
		payload, _, _, err := c.requestJSON(ctx, http.MethodGet, c.endpoint(candidate.key, candidate.path), candidate.values, nil)
		if err != nil {
			lastErr = err
			continue
		}
		items := extractItems(payload)
		channels := make([]core.ChannelInfo, 0, len(items))
		for _, item := range items {
			channel, err := parseChannel(item)
			if err == nil {
				channels = append(channels, channel)
			}
		}
		if len(channels) > 0 {
			return channels, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("no channels returned by NewAPI management API")
}

func (c *Client) discoverFromSQLite(ctx context.Context) ([]core.ChannelInfo, error) {
	dbPath := c.cfg.Discovery.SQLitePath
	if dbPath == "" {
		return nil, errors.New("discovery.sqlite_path is required for sqlite discovery")
	}
	dsn := dbPath
	if !strings.HasPrefix(dbPath, "file:") && dbPath != ":memory:" {
		dsn = "file:" + strings.ReplaceAll(dbPath, "\\", "/") + "?mode=ro"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, c.cfg.Discovery.SQLiteQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var channels []core.ChannelInfo
	for rows.Next() {
		values := make([]any, len(columns))
		valuePtrs := make([]any, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, column := range columns {
			row[strings.ToLower(column)] = normalizeDBValue(values[i])
		}
		channel, err := parseChannel(row)
		if err == nil {
			channels = append(channels, channel)
		}
	}
	return channels, rows.Err()
}

func (c *Client) runAction(ctx context.Context, action string, channel core.ChannelInfo, template config.ActionTemplate, status int, dryRun bool) (core.ActionResult, error) {
	if dryRun {
		return core.ActionResult{OK: true, Action: action, DryRun: true, Message: "dry-run"}, nil
	}
	body := renderTemplateMap(template.Body, map[string]string{
		"id":              strconv.FormatInt(channel.ID, 10),
		"name":            channel.Name,
		"group":           channel.Group,
		"status":          strconv.Itoa(status),
		"enabled_status":  strconv.Itoa(c.cfg.NewAPI.EnabledStatus),
		"disabled_status": strconv.Itoa(c.cfg.NewAPI.DisabledStatus),
	})
	if template.FetchBeforeUpdate {
		detail, err := c.channelDetail(ctx, channel.ID)
		if err != nil {
			return core.ActionResult{OK: false, Action: action, Message: err.Error()}, err
		}
		for key, value := range body {
			detail[key] = value
		}
		body = detail
	}
	method := template.Method
	if method == "" {
		method = http.MethodPut
	}
	_, statusCode, responseBody, err := c.requestJSON(ctx, method, template.Path, nil, body)
	if err != nil {
		return core.ActionResult{OK: false, Action: action, Message: err.Error()}, err
	}
	return core.ActionResult{
		OK:      statusCode >= 200 && statusCode < 300,
		Action:  action,
		DryRun:  false,
		Message: excerpt(responseBody),
	}, nil
}

func (c *Client) channelDetail(ctx context.Context, channelID int64) (map[string]any, error) {
	endpoint := c.endpoint("channel_detail", "/api/channel/{id}")
	endpoint = strings.ReplaceAll(endpoint, "{id}", strconv.FormatInt(channelID, 10))
	payload, _, _, err := c.requestJSON(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, err
	}
	if data, ok := payload["data"].(map[string]any); ok {
		return sanitizeMap(data), nil
	}
	return sanitizeMap(payload), nil
}

func (c *Client) requestJSON(ctx context.Context, method, endpoint string, values url.Values, body map[string]any) (map[string]any, int, string, error) {
	bodyReader := io.Reader(nil)
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, 0, "", err
		}
		bodyReader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.absoluteURL(endpoint, values), bodyReader)
	if err != nil {
		return nil, 0, "", err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range c.cfg.NewAPI.Headers {
		req.Header.Set(key, value)
	}
	if c.cfg.NewAPI.AdminUserID != "" {
		req.Header.Set("New-Api-User", c.cfg.NewAPI.AdminUserID)
	}
	if c.cfg.NewAPI.AdminToken != "" {
		value := c.cfg.NewAPI.AdminToken
		if c.cfg.NewAPI.AdminTokenPrefix != "" {
			value = c.cfg.NewAPI.AdminTokenPrefix + " " + value
		}
		req.Header.Set(c.cfg.NewAPI.AdminTokenHeader, value)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return nil, resp.StatusCode, "", err
	}
	text := string(data)
	payload := map[string]any{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &payload)
	}
	if resp.StatusCode >= 400 {
		return payload, resp.StatusCode, text, fmt.Errorf("%s", firstMessage(payload, text))
	}
	return payload, resp.StatusCode, text, nil
}

func (c *Client) endpoint(key, fallback string) string {
	if value := c.cfg.NewAPI.Endpoints[key]; value != "" {
		return value
	}
	return fallback
}

func (c *Client) absoluteURL(endpoint string, values url.Values) string {
	base := strings.TrimRight(c.cfg.NewAPI.BaseURL, "/")
	if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		base = ""
	}
	target := base + "/" + strings.TrimLeft(endpoint, "/")
	if values != nil && len(values) > 0 {
		target += "?" + values.Encode()
	}
	return target
}

func extractItems(payload map[string]any) []map[string]any {
	if items := itemList(payload); len(items) > 0 {
		return items
	}
	data, ok := payload["data"]
	if !ok {
		return nil
	}
	if dataMap, ok := data.(map[string]any); ok {
		return itemList(dataMap)
	}
	if dataList, ok := data.([]any); ok {
		return convertItemList(dataList)
	}
	return nil
}

func itemList(payload map[string]any) []map[string]any {
	for _, key := range []string{"items", "channels", "rows", "records", "list"} {
		if raw, ok := payload[key].([]any); ok {
			items := convertItemList(raw)
			if len(items) > 0 {
				return items
			}
		}
	}
	return nil
}

func convertItemList(raw []any) []map[string]any {
	items := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if itemMap, ok := item.(map[string]any); ok {
			items = append(items, itemMap)
		}
	}
	return items
}

func parseChannel(item map[string]any) (core.ChannelInfo, error) {
	item = sanitizeMap(item)
	id, ok := intValue(firstValue(item, "id", "channel_id", "ID"))
	if !ok {
		return core.ChannelInfo{}, errors.New("channel has no id")
	}
	name := stringValue(firstValue(item, "name", "channel_name"))
	if name == "" {
		name = fmt.Sprintf("channel-%d", id)
	}
	models := parseModels(firstValue(item, "models", "model_mapping", "model"))
	testModel := stringValue(firstValue(item, "test_model", "testModel"))
	if testModel != "" && !contains(models, testModel) {
		models = append(models, testModel)
	}
	group := stringValue(firstValue(item, "group", "group_name", "groupName"))
	autoBan := boolPtr(firstValue(item, "auto_ban", "autoBan"))
	return core.ChannelInfo{
		ID:        id,
		Name:      name,
		Type:      stringValue(firstValue(item, "type")),
		Status:    stringValue(firstValue(item, "status", "enabled")),
		Models:    models,
		TestModel: testModel,
		Group:     group,
		AutoBan:   autoBan,
	}, nil
}

func successfulTest(payload map[string]any, statusCode int, body string) (bool, string) {
	if statusCode < 200 || statusCode >= 300 {
		return false, firstMessage(payload, body)
	}
	if value, ok := payload["success"].(bool); ok && !value {
		return false, firstMessage(payload, body)
	}
	if code, ok := intValue(payload["code"]); ok && code != 0 && code != 200 {
		return false, firstMessage(payload, body)
	}
	message := firstMessage(payload, "")
	if message != "" {
		lower := strings.ToLower(message)
		if strings.Contains(lower, "fail") || strings.Contains(lower, "error") || strings.Contains(message, "失败") || strings.Contains(message, "错误") {
			return false, message
		}
	}
	return true, ""
}

func firstMessage(payload map[string]any, fallback string) string {
	for _, key := range []string{"message", "msg", "error", "detail"} {
		if value := stringValue(payload[key]); value != "" {
			return value
		}
	}
	if data, ok := payload["data"].(map[string]any); ok {
		if message := firstMessage(data, ""); message != "" {
			return message
		}
	}
	return excerpt(fallback)
}

func renderTemplateMap(body map[string]any, values map[string]string) map[string]any {
	rendered := map[string]any{}
	for key, value := range body {
		rendered[key] = renderTemplateValue(value, values)
	}
	return rendered
}

func renderTemplateValue(value any, values map[string]string) any {
	switch typed := value.(type) {
	case string:
		rendered := typed
		for key, replacement := range values {
			rendered = strings.ReplaceAll(rendered, "{"+key+"}", replacement)
		}
		if number, err := strconv.Atoi(rendered); err == nil {
			return number
		}
		return rendered
	case map[string]any:
		return renderTemplateMap(typed, values)
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, renderTemplateValue(item, values))
		}
		return out
	default:
		return value
	}
}

func parseModels(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case []string:
		return compactStrings(typed)
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := stringValue(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	case map[string]any:
		out := make([]string, 0, len(typed))
		for key := range typed {
			out = append(out, key)
		}
		return out
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		var list []string
		if err := json.Unmarshal([]byte(text), &list); err == nil {
			return compactStrings(list)
		}
		var dict map[string]any
		if err := json.Unmarshal([]byte(text), &dict); err == nil {
			out := make([]string, 0, len(dict))
			for key := range dict {
				out = append(out, key)
			}
			return out
		}
		return compactStrings(strings.Split(text, ","))
	default:
		if text := stringValue(value); text != "" {
			return compactStrings(strings.Split(text, ","))
		}
		return nil
	}
}

func compactStrings(input []string) []string {
	out := make([]string, 0, len(input))
	seen := map[string]struct{}{}
	for _, item := range input {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func firstValue(item map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := item[key]; ok {
			return value
		}
		if value, ok := item[strings.ToLower(key)]; ok {
			return value
		}
	}
	return nil
}

func intValue(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	case json.Number:
		number, err := typed.Int64()
		return number, err == nil
	case []byte:
		return intValue(string(typed))
	case string:
		if typed == "" {
			return 0, false
		}
		number, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return number, err == nil
	default:
		return 0, false
	}
}

func boolPtr(value any) *bool {
	switch typed := value.(type) {
	case nil:
		return nil
	case bool:
		return &typed
	case int:
		out := typed != 0
		return &out
	case int64:
		out := typed != 0
		return &out
	case float64:
		out := typed != 0
		return &out
	case []byte:
		return boolPtr(string(typed))
	case string:
		text := strings.TrimSpace(strings.ToLower(typed))
		if text == "" {
			return nil
		}
		out := text == "1" || text == "true" || text == "yes" || text == "on"
		if out || text == "0" || text == "false" || text == "no" || text == "off" {
			return &out
		}
		return nil
	default:
		return nil
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case []byte:
		return strings.TrimSpace(string(typed))
	case json.Number:
		return typed.String()
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func normalizeDBValue(value any) any {
	if data, ok := value.([]byte); ok {
		return string(data)
	}
	return value
}

func sanitizeMap(input map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		if _, sensitive := sensitiveKeys[strings.ToLower(key)]; sensitive {
			continue
		}
		if child, ok := value.(map[string]any); ok {
			out[key] = sanitizeMap(child)
			continue
		}
		out[key] = value
	}
	return out
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func excerpt(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if len(text) <= 500 {
		return text
	}
	return text[:500]
}

func cleanJoin(base, elem string) string {
	if strings.HasPrefix(elem, "http://") || strings.HasPrefix(elem, "https://") {
		return elem
	}
	base = strings.TrimRight(base, "/")
	elem = "/" + strings.TrimLeft(elem, "/")
	return base + path.Clean(elem)
}
