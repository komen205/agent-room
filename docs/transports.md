# Transports

agent-room ships with two message transports. The choice is a runtime config (`TRANSPORT` env var); the agents themselves don't know or care which is in use.

## Ably Chat (default)

- **What it is:** Hosted pub/sub service from Ably. Free tier covers ~3M messages/month, no infrastructure to run.
- **When to pick it:** You want zero ops. You don't mind a hosted dependency. Your agents are across the internet and you'd rather not expose a broker yourself.
- **Env vars:** `TRANSPORT=ably`, `ABLY_API_KEY=<your-key>`.
- **Dependencies:** `ably`, `@ably/chat` (already in `package.json`).
- **Wire format:** Ably Chat messages with `text` + `metadata.next`. `clientId` comes from the Ably connection identity.

### Ably-specific features

The Ably SDK gives us more than we use today: presence, occupancy, message reactions, room reactions, typing indicators, message history queries. See `docs/faq.md` for the shortlist of features worth adopting and the AI-specific [`@ably/ai-transport`](https://github.com/ably/ably-ai-transport-js) SDK.

## NATS

- **What it is:** Open-source, high-performance pub/sub messaging system. Single binary or single Docker container. Built for service-to-service messaging.
- **When to pick it:** You want self-hosted. You already run NATS. You want zero external dependencies. You're on an air-gapped or restricted network.
- **Env vars:**
  - `TRANSPORT=nats`
  - `NATS_URL=nats://host:4222` (defaults to `nats://localhost:4222`)
  - `NATS_USER`, `NATS_PASS` (basic auth, optional)
  - `NATS_TOKEN` (token auth, optional)
- **Dependencies:** `nats` (already in `package.json`).

### Running NATS

For local dev, use the bundled Docker Compose:

```bash
docker compose up -d nats
docker compose logs -f nats   # watch startup
curl -s http://localhost:8222/healthz   # should return "ok"
```

For production, run `nats-server` natively (one binary, ~20MB) or deploy via Kubernetes with the `nats` Helm chart. Add auth before exposing publicly — NATS is unauthenticated by default. Basic auth via `NATS_USER` + `NATS_PASS` or token auth via `NATS_TOKEN` works out of the box with the client.

### Wire format

Every message published on the NATS subject `agent-room.<roomName>` is a JSON envelope:

```json
{
  "clientId": "reviewer",
  "text": "…",
  "metadata": { "next": "implementer-a" }
}
```

Subscribers filter same-clientId echoes client-side.

### Message persistence

The bundled NATS config does **not** enable JetStream, so messages are fire-and-forget. If an agent is offline when you publish, it misses the message. This matches the current Ably behaviour (we don't use Ably's history either).

To add persistence + replay, enable JetStream in the broker config and convert `NatsTransport` to use durable consumers. See the [NATS JetStream docs](https://docs.nats.io/nats-concepts/jetstream). Noted as a future improvement.

## Comparing the two

| | Ably | NATS |
|---|---|---|
| Infrastructure | None (hosted) | 1 container / binary |
| Cost | Free tier | Self-hosted |
| Message retention | Server-side (configurable, not wired here) | None by default (add JetStream) |
| Presence / typing / reactions | Built-in (not yet wired) | Would need extra subjects |
| Reconnect semantics | Automatic | Automatic (client retries forever) |
| Auth | API key | User/pass, token, mTLS (not wired) |
| Latency across internet | ~50-200ms | Depends on your hop |
| Latency LAN | n/a | ~1-5ms |

## Writing a new transport

`Transport` is a 4-method interface in `src/transport.ts`:

```ts
interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(handler: TransportHandler): void;
  publish(text: string, metadata?: { next?: string }): Promise<void>;
}
```

To add (say) a Redis transport, copy `src/transport/nats.ts` to `src/transport/redis.ts`, swap the NATS client for `ioredis`, register it in `createTransport()`, and add the kind to `resolveTransportKind()`. ~60 lines total.

Kafka, MQTT, Postgres LISTEN/NOTIFY, plain WebSocket, whatever — same pattern.
