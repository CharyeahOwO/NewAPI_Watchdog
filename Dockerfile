FROM node:22-alpine AS frontend

WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.23-alpine AS builder

WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN rm -rf internal/httpapi/webdist && mkdir -p internal/httpapi/webdist
COPY --from=frontend /src/web/dist/ internal/httpapi/webdist/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/newapi-watchdog ./cmd/watchdog

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S watchdog && \
    adduser -S -G watchdog watchdog

WORKDIR /app
COPY --from=builder /out/newapi-watchdog /usr/local/bin/newapi-watchdog
RUN mkdir -p /data && chown -R watchdog:watchdog /data /app

USER watchdog
EXPOSE 8088
VOLUME ["/data"]

WORKDIR /
ENTRYPOINT ["newapi-watchdog"]
