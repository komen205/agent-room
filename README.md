# agent-room

A pattern for running multiple Claude-driven agents as **separate OS processes**, coordinating via an [Ably Chat](https://ably.com/docs/chat) room. Each agent is a `claude` CLI subprocess with its own working directory, system prompt, and session memory.

## Why this exists

Most multi-agent frameworks (AutoGen, CrewAI, MetaGPT) run all agents in a single process. That's usually the right call. This project exists for the cases where it isn't:

- You want each agent to use **different local Claude Code auth** (e.g., different subscription tiers on different machines, or different MCP server configs).
- You want each agent to have a **different working directory** so it only sees the repo/area it owns.
- You want to run agents on **physically different machines** that happen to share a message broker.
- You want to inspect each agent independently — its own terminal, its own log file, its own session history.

If none of that applies, use an in-process framework instead. See `docs/faq.md` for the honest comparison.

## Architecture

```
┌──────────┐           ┌──────────────┐           ┌──────────┐
│ agent A  │ subscribe │              │ subscribe │ agent B  │
│ (Claude  │◀──────────│ Ably Chat    │──────────▶│ (Claude  │
│  CLI +   │   publish │ room         │   publish │  CLI +   │
│  tools)  │──────────▶│              │◀──────────│  tools)  │
└──────────┘           └──────────────┘           └──────────┘
     │                         ▲                        │
     │ publish                 │ subscribe              │
     ▼                         │                        ▼
┌──────────┐                   │                 ┌──────────┐
│ reviewer │───────────────────┘                 │ scout    │
│ (listens │                                     │ (listens │
│  to all) │                                     │  to all) │
└──────────┘                                     └──────────┘
```

Each Ably message carries a `metadata.next` field naming the next speaker (or `"all"` for broadcast). Executors respond only when addressed; reviewers and scouts listen to everything and decide for themselves whether to speak (`NOOP` to stay silent).

Each `claude` subprocess is invoked with:
- `--append-system-prompt` (first turn) or `--resume <session_id>` (subsequent turns) — gives each agent durable memory.
- `--output-format stream-json` — so we can stream tool calls and text to the log in real time.
- `--dangerously-skip-permissions` — agents have full tool access by design. Read the warnings below.

## Quickstart

**Prerequisites:**
- Node 22.16+ (24 recommended)
- [`claude` CLI](https://docs.claude.com/en/docs/claude-code) installed and logged in (`claude login`)
- [`gh` CLI](https://cli.github.com/) logged in (only if you want the example's PR flow)
- A free [Ably](https://ably.com) account — the free tier covers ~3M messages/month.

```bash
git clone https://github.com/komen205/agent-room.git
cd agent-room
npm install
cp .env.example .env
# edit .env and paste your ABLY_API_KEY
```

**Try the software-engineering example** (4 agents optimising a public codebase):

```bash
# Clone a target codebase to point the agents at (the example assumes expressjs/express)
git clone https://github.com/expressjs/express ~/code/express

# Point the example config at it (edit cwd paths in examples/software-engineering/agents.yaml)
export CONFIG_FILE=examples/software-engineering/agents.yaml

# In four separate terminals:
NAME=reviewer      npm start
NAME=implementer-a npm start
NAME=implementer-b npm start
NAME=scout         npm start

# Optional 5th terminal for merged real-time log view:
npm run tail
```

The **reviewer** posts an opening message assigning work; **implementer-a** and **implementer-b** execute in parallel; **scout** surfaces new findings in `campaign/scout-findings/inbox/`.

To inject a message from outside the agent mesh (e.g., to redirect the conversation):
```bash
npm run notify -- <agent-name|all> "your instruction text"
```

## Defining your own roles

Roles are YAML-configured. Each agent has a **kind** that determines its built-in behaviour:

| Kind | Listens to | Can NOOP | Default addressee |
|---|---|---|---|
| `executor` | messages addressed to it (or `all`) | no — always replies | configured peer (ping-pong) |
| `reviewer` | everything | yes | message sender |
| `scout` | everything | yes | configured peer |

The `kind` is the only behavioural switch. Personality, mission, tool usage, and workflow all come from the **system prompt** you write in a Markdown file alongside the config. See `docs/roles.md`.

## What's in the box

- `src/agent.ts` — the runtime loop (subscribe, ask subprocess, publish, queue, persist session).
- `src/config.ts` — YAML loader with `{{placeholder}}` substitution in prompts.
- `scripts/notify.ts` — inject messages from outside the mesh.
- `examples/software-engineering/` — example campaign against a public codebase with four agent roles.
- `docs/architecture.md` — message flow, queue behaviour, session persistence details.
- `docs/roles.md` — how to define new roles and write good system prompts.
- `docs/faq.md` — when to use this vs in-process frameworks; known limitations.

## Safety

Agents run with `--dangerously-skip-permissions`. They can execute arbitrary shell commands, create branches, push to GitHub, and hit any MCP server configured in your global `~/.claude.json`. Treat every agent like a junior engineer with root access:

- Point their `cwd` at repos you can tolerate them editing.
- Avoid pointing them at repos with secrets in working-tree scripts.
- If you give them `gh` auth, they can open PRs as you. Consider using a bot account for automation.
- The Ably room key and any API key pasted in `.env` should not be committed — `.env` is already gitignored.

## Prior art and credits

Thanks to the authors of [Ably Chat](https://ably.com/docs/chat) and the [Claude Agent SDK](https://docs.claude.com/en/docs/claude-code/sdk).

Comparable projects — check them first if in-process is fine for your use case:

- [MetaGPT](https://github.com/FoundationAgents/MetaGPT) — role-based software-dev agents (closest in spirit).
- [ChatDev](https://github.com/OpenBMB/ChatDev) — multi-agent software company.
- [AG2 / AutoGen](https://github.com/ag2ai/ag2) — `GroupChatManager` pattern; similar role-with-prompts model.
- [CrewAI](https://github.com/crewAIInc/crewAI) — role + task + process abstractions.
- [OpenAI Swarm](https://github.com/openai/swarm) — lightweight in-process orchestration.

## License

MIT — see `LICENSE`.
