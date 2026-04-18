# FAQ

## Should I use this or AutoGen / CrewAI / MetaGPT?

Probably not this. Those frameworks have more features, better observability, and active communities. Use this instead when:

- Each agent needs to run on a **different machine** (different auth tokens, different MCP configs, different local tool access) and you'd rather not manage that via a single process.
- Each agent needs a **distinct `cwd`** and you'd like OS-level isolation instead of framework-level.
- You want each agent's log, terminal, and session file to be inspectable independently — debug one without attaching to a shared runtime.
- You're curious about the pattern and want a small, readable (~250-line) reference implementation.

Otherwise, in-process frameworks are simpler, cheaper (shared context reduces tokens), and better-tested.

## Why is multi-process multi-agent rare in general?

Ordered by impact:

1. **Single-agent is winning commercially.** Cursor Agent, Claude Code, Devin, Cognition — all single-process, single-agent. Coordination overhead usually exceeds the benefit of splitting work across roles.
2. **LLM inference dominates latency and cost.** IPC is microseconds; inference is seconds to minutes. Multi-process adds negligible latency but significant operational overhead.
3. **Shared context is the hard problem.** In-process agents share memory; multi-process agents re-parse context in fresh LLM sessions. You pay tokens twice.
4. **Coordination bugs are real.** Race conditions, turn ordering, drop-on-busy, one agent waiting on another that crashed. Frameworks with explicit managers (`GroupChatManager`) solve these; hand-rolled setups have to solve them again.
5. **Observability is brutal.** One process = one log, one debugger. Four processes across machines = distributed tracing territory.

## Why subprocesses instead of the Anthropic SDK?

Three reasons specific to this project:

1. **Auth reuse** — each agent gets the local machine's Claude Code login. No API-key management per agent. Pro subscriptions work.
2. **MCP reuse** — the CLI automatically picks up the user's `~/.claude.json` MCP servers. Moving to the SDK would mean replicating that config per agent.
3. **Tool permission model** — `--dangerously-skip-permissions` + `--add-dir` + `--allowedTools` / `--disallowedTools` gives per-agent tool scoping at the CLI level. Replicating via SDK means writing a permission gateway.

Trade-offs: subprocess startup latency per turn (~1-2s); stdout parsing instead of typed events; stream-json format is undocumented but stable.

## Why Ably Chat instead of Redis pub/sub or NATS?

No strong reason — the transport is replaceable. Ably was chosen because:

- It has a hosted free tier (3M messages/month) with no infrastructure to run.
- The SDK is TypeScript-native with typed message metadata and chat-specific primitives.
- Agents on different physical machines can talk without shared networking.

If you want to swap it, the integration points are `subscribe`, `publish(text, metadata)`, `attach(room)`, and the `clientId` property — wrap those behind an interface and plug in whatever you like. Not currently parameterised in the framework.

## What happens if an agent crashes mid-campaign?

Nothing automatic. The other agents will happily keep running. If the crashed agent was addressed as `nextSpeaker`, the room will fall silent (no one else replies to a message addressed to a missing agent).

Recovery:
1. Check `logs/<name>.log` for the crash cause.
2. Fix the issue.
3. `NAME=<name> npm start` — the saved session in `.sessions/<name>.json` resumes, but any messages that arrived during downtime are lost (Ably Chat persists history server-side, but we don't rewind on reconnect).

For production, wrap each agent in a supervisor (systemd, launchd, `pm2`, etc.) and consider a persistent message queue that resumes from a cursor.

## Why does the reviewer NOOP so often?

Two reasons, both features not bugs:

1. **The NOOP sentinel is how the reviewer stays silent.** Without it, the reviewer would reply to every message — creating a response storm and pulling conversation away from the workers.
2. **The LLM internalises "default to NOOP" from the per-turn prompt.** If you want the reviewer to speak up more, edit its system prompt to lower its intervention threshold. The framework just checks `reply === "NOOP"` — your system prompt decides when to emit it.

If the reviewer is too quiet to be useful:
- Clear its session (`rm .sessions/<reviewer-name>.json`) to re-bake a stricter system prompt.
- Add explicit "MANDATORY intervention when…" bullets to the system prompt.

## Does this work on Windows?

Untested. The `spawn('claude', ...)` call should work on Windows if the `claude` CLI is on PATH. The `tail -F logs/*.log` npm script won't work in PowerShell — use WSL or rewrite the script.

## Cost ballpark

A 4-agent campaign running for ~2 hours of real time with each agent taking ~30 turns produces ~500k-1M tokens total across all agents. At current Sonnet pricing that's single-digit dollars. Longer campaigns scale roughly linearly. The turn cap (`MAX_TURNS=50` default) is your ceiling — adjust it based on wallet tolerance.

## Can I add a fifth agent?

Yes. Add an entry to `agents.yaml`, add a system-prompt Markdown file, and run `NAME=<newname> npm start`. The only cross-agent constraint is that `nextSpeaker` references must resolve to known names (or `sender` for reviewers).
