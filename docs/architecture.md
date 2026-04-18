# Architecture

## Message flow

Each agent is an independent Node process running `src/agent.ts`. At startup it:

1. Loads `config/agents.yaml` + the system/opener prompts for its own `NAME`.
2. Connects to Ably Chat as that client ID.
3. Subscribes to the configured room.
4. If the role has an `openerPromptFile`, waits a few seconds for peers to come online, then runs the opener through a `claude` subprocess and publishes the result.

Per incoming message, the handler runs:

```
received message
    ↓
is it from me? ────────────────── yes → drop
    ↓ no
is it addressed to me?
    (listenAll or metadata.next == my name or "all")
    ↓ no → drop
    ↓ yes
turn cap reached? ─────────────── yes → drop + log cap
    ↓ no
am I busy? ─────────── yes → push to bounded queue (depth ≤ 10)
    ↓ no
build per-turn prompt
spawn `claude` subprocess, stream stdout
reply is "NOOP" and role.canNoop? ── yes → log + drop
    ↓ no
resolve addressee (role.nextSpeaker or sender)
publish reply to Ably with metadata.next = addressee
drain queue (process one, recurse)
```

## Routing via `metadata.next`

Every published message carries `metadata: { next: <name | "all"> }`. Executors filter strictly:

```ts
if (!listenAll && meta.next && meta.next !== NAME && meta.next !== "all") return;
```

Reviewers and scouts set `listenAll = true` and evaluate every message themselves. They rely on the `NOOP` sentinel to stay silent when they have nothing useful to add.

## Busy queue

While the handler is awaiting a `claude` subprocess, a second incoming message can arrive. Dropping it entirely (original behaviour) made the agents ignore operator messages and peer follow-ups. The current implementation keeps a small FIFO:

```ts
const queue: ChatMessageEvent[] = [];

subscribe((event) => {
  if (busy) {
    if (queue.length >= 10) queue.shift();   // bound growth
    queue.push(event);
    return;
  }
  handle(event);
});

// in handler finally:
const nextEvent = queue.shift();
if (nextEvent) handle(nextEvent);
```

Depth 10 is arbitrary but high enough that operators can burst-send instructions without losing messages, and low enough to avoid memory pressure across long-running campaigns.

## Session persistence

Each agent saves its latest `claude` session ID to `.sessions/<NAME>.json` after every completed subprocess call. On boot, the saved session (if any) is passed via `--resume <id>` on the first `ask()`, so the LLM retains full conversational context across restarts.

Caveat: **system prompts are baked into a session on turn 0**. If you change `*.system.md` files and then resume, the agent still sees the old system prompt — only the new per-turn user message is visible. Delete `.sessions/<name>.json` to force a fresh session with the current system prompt.

## Why subprocesses instead of the SDK

The `claude` CLI is used instead of the `@anthropic-ai/sdk` (or `claude-agent-sdk`) for three reasons:

1. **Auth reuse** — each agent inherits the local machine's Claude Code login. No API key management per agent.
2. **Tool / MCP reuse** — the CLI picks up the user's `~/.claude.json`, which includes MCP servers. In-process SDK usage would require replicating that config per agent.
3. **Process isolation** — each agent's `cwd`, env, and tool permissions are isolated at the OS level. The SDK would require manual sandboxing.

The cost is latency (subprocess startup per turn) and that we parse stream-json from stdout instead of receiving typed events. For campaign-length runs (seconds per turn dominated by LLM inference), the tradeoff is acceptable.

## Concurrency model

Each agent is single-process, single-threaded Node with a sequential handler. A role never runs two subprocesses in parallel. If you want parallel work on the same role, run two agents with different `NAME` values pointing at the same config entry — but the config currently assumes 1:1 name-to-role mapping, so you'd need to define two entries (e.g., `worker-a` and `worker-b`) with distinct names but identical prompts.

Across agents there is **no central supervisor**. Each agent runs independently. If one crashes, the others carry on until they stall waiting for the missing agent's reply. Recovery is manual: restart the crashed agent. For production use you'd want systemd / launchd / a process supervisor around each.

## Token and cost behaviour

Every subprocess invocation pays the full conversation context in tokens — there's no cross-agent context sharing. If Alice explains something to Bob, Bob's next turn re-parses Alice's explanation via his own LLM context. Multi-agent runs are more token-expensive than an equivalent single-agent run doing the same work.

The `--resume` flag keeps the per-agent history compact (server-side session), so within one agent's lifetime the context grows linearly with its own turns, not with the total chat volume.
