# Example: software-engineering campaign

Four agents running a code-optimisation campaign against a public Node/TypeScript codebase.

## Cast

- **reviewer** — prioritises work, reviews PRs, assigns items.
- **implementer-a** — ships PRs focused on core library code (`src/`).
- **implementer-b** — ships PRs focused on tests, benchmarks, examples.
- **scout** — scans the repo for new optimisation candidates, drops findings in `scout-findings/inbox/` for the reviewer to triage.

## Target repo

This example is written to work against any small Node/TS codebase. Suggested targets:

- **[expressjs/express](https://github.com/expressjs/express)** — small, well-known, JavaScript, clear structure.
- **[sindresorhus/ky](https://github.com/sindresorhus/ky)** — small TypeScript HTTP client.
- **[tj/commander.js](https://github.com/tj/commander.js)** — small Node CLI framework.
- Any repo of your own where you wouldn't mind agents opening PRs.

Clone your target once and keep it somewhere the agents can access:

```bash
git clone https://github.com/expressjs/express ~/code/express
```

## Setup

1. **Install agent-room** (from the repo root):

   ```bash
   npm install
   cp .env.example .env
   # edit .env — paste your ABLY_API_KEY
   ```

2. **Point the example config at your target repo**: edit every `cwd:` field in `examples/software-engineering/agents.yaml` to the absolute path of your local clone.

3. **Set up a campaign directory** — the reviewer writes `task_plan.md`, `progress.md`, the backlog, and scout findings here. It can live anywhere; simplest is inside the agent-room repo:

   ```bash
   mkdir -p examples/software-engineering/campaign/scout-findings/{inbox,promoted,discarded}
   cp examples/software-engineering/backlog.md examples/software-engineering/campaign/backlog.md
   ```

   Then tell the agents where it lives by editing the `<campaign-dir>` mentions in the prompt files, or set an env var the prompts can reference. Simplest: edit the prompts to point at your campaign dir directly.

4. **Decide on a fresh Ably room** per campaign — set `ROOM_NAME` in `.env` or edit the `room:` field in `agents.yaml`. Reusing an old room will mix messages with prior runs.

## Run

Four terminals, all in the agent-room repo root:

```bash
export CONFIG_FILE=examples/software-engineering/agents.yaml

# Terminal 1 — the reviewer kicks off the campaign
NAME=reviewer npm start

# Terminal 2 — implementer-a
NAME=implementer-a npm start

# Terminal 3 — implementer-b
NAME=implementer-b npm start

# Terminal 4 — scout
NAME=scout npm start
```

Optional terminal 5 — merged real-time log stream:

```bash
npm run tail
```

Within 30 seconds:
- The reviewer posts the opening rank + assignments (`metadata.next: all`).
- The scout drops its first findings into `scout-findings/inbox/`.
- The implementers pick up their assignments and start shipping.

## Injecting messages

From another terminal (while agents are running):

```bash
npm run notify -- reviewer "Skip item X for now, focus on Y first."
npm run notify -- scout    "Run a dead-code sweep next."
npm run notify -- all      "Wrap up this round; next round picks up next campaign."
```

## When it goes wrong

- **An agent is unresponsive**: check `logs/<name>.log`. Kill, fix, restart.
- **Reviewer NOOPs too often**: edit `prompts/reviewer.system.md` to lower its threshold. Restart with a fresh session (`rm .sessions/reviewer.json`) so the new prompt takes effect.
- **Messages dropped during high activity**: the busy queue is bounded to depth 10 — if you see `queue` log lines followed by missing messages, reduce the rate of external `notify` calls.
- **Subprocess hangs**: check whether `claude` CLI is responsive (`claude --version`). A global Claude Code update can change output format.

## Stopping

`Ctrl+C` each terminal. Session state in `.sessions/*.json` persists — restarting resumes the conversation. If you want a clean slate: `rm .sessions/*.json`.
