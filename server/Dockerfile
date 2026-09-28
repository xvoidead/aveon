# Сборка: статический бинарник без cgo (SQLite на чистом Go)
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go schema.sql ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /aveon . && mkdir /data

# Запуск: минимальный образ без шелла, не от root (uid 65532)
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /aveon /aveon
COPY --from=build --chown=65532:65532 /data /data

ENV AVEON_HOST=0.0.0.0 \
    AVEON_PORT=8787 \
    AVEON_DB=/data/aveon.db

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["/aveon", "health"]
ENTRYPOINT ["/aveon"]
