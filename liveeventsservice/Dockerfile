FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o liveeventsservice ./cmd

FROM alpine:3.20

WORKDIR /app

COPY --from=builder /app/liveeventsservice ./liveeventsservice

EXPOSE 8080

CMD ["./liveeventsservice"]