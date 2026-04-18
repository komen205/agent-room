# Defining roles

A role = one YAML entry in `agents.yaml` + one system-prompt Markdown file + optionally one opener-prompt Markdown file.

## Minimal example

`config/agents.yaml`:
```yaml
room: my-campaign
agents:
  alice:
    kind: executor
    cwd: /Users/me/code/project
    nextSpeaker: bob
    systemPromptFile: prompts/alice.system.md
  bob:
    kind: executor
    cwd: /Users/me/code/project
    nextSpeaker: alice
    systemPromptFile: prompts/bob.system.md
```

`config/prompts/alice.system.md`:
```markdown
You are {{name}}, working on the codebase at {{cwd}}. Your peers are: {{peers}}.

Mission: ...
Workflow: ...
Rules:
- Keep replies under 6 sentences.
- Cite files and line numbers.
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `executor` \| `reviewer` \| `scout`. Determines listen-all, NOOP, and default addressee behaviour. |
| `cwd` | yes | Absolute working directory. `claude` subprocesses run with this cwd and `--add-dir <cwd>`. |
| `nextSpeaker` | yes | The name of the peer this role always addresses its replies to, **or** the literal string `sender` (only valid for `reviewer` — reply to whoever just spoke). |
| `systemPromptFile` | yes | Path (relative to the YAML file) to a Markdown file containing the system prompt. |
| `openerPromptFile` | no | Path to a Markdown file containing a one-shot opener prompt. If set, this role runs the opener at startup after a short delay. |

## Placeholders

System prompts and opener prompts are Markdown files processed with simple `{{var}}` substitution at load time. Available variables:

- `{{name}}` — the role's own name.
- `{{peers}}` — comma-separated names of every other role.
- `{{cwd}}` — the role's working directory.

Unknown `{{...}}` expressions are left untouched.

## Kinds

### `executor`

- Listens only to messages explicitly addressed to it (`metadata.next == name` or `metadata.next == "all"`).
- Always replies — no `NOOP` semantics.
- Addresses every reply to its configured `nextSpeaker`.
- Typical use: a worker that does a concrete task per turn (implement a fix, run a verification, ship a PR).
- `nextSpeaker` must be a peer name — `sender` isn't supported for executors (they don't reason about "who sent this").

### `reviewer`

- Listens to every message in the room (`listenAll`).
- On each message, decides whether to reply or return `NOOP` (silence). The framework drops any reply that matches `^\s*NOOP\s*$` case-insensitively.
- If the message contains a GitHub PR URL, the framework injects a mandatory-review prompt (no NOOP allowed for PR URLs).
- Addresses replies to the message's sender by default (`nextSpeaker: sender`) or to a fixed peer if you configure one.
- Typical use: evaluator, approver, editor, fact-checker, prioritiser.

### `scout`

- Listens to every message (`listenAll`).
- Defaults to silence (`NOOP`) unless directly addressed or following up on a prior finding.
- Addresses replies to the configured `nextSpeaker` (usually the reviewer).
- Typical use: background researcher that drops findings to a kanban inbox; roaming investigator that runs a scan when told.

## Writing good system prompts

The agents are Claude CLI subprocesses, so they already know how to use tools. Your system prompt should:

1. **Identity** — who is the agent, who are its peers, what's the campaign about.
2. **Mission** — one-sentence goal, concrete and measurable.
3. **Workflow** — numbered steps for a typical turn. Be explicit: "read X, then do Y, then post Z."
4. **Rules** — reply length, citation discipline, forbidden actions (`--no-verify`, force push, etc.), escalation path.
5. **What to produce on each turn** — be specific about the shape of a good reply so the reviewer knows what to approve.

Avoid:

- Vague missions ("improve code quality"). Be concrete ("find `any` casts in `payload.config` accesses and propose fixes").
- Persona role-play that doesn't constrain behaviour. "You are a kind engineer" wastes tokens.
- Embedding external state (PR URLs, issue IDs). That belongs in per-turn injected messages, not the baked-in system prompt.

## Changing a system prompt on a live campaign

System prompts are baked into the `claude` session at turn 0. After turn 0, only per-turn user messages reach the LLM. If you change `alice.system.md` while the campaign is running:

- Restarting `NAME=alice npm start` with `.sessions/alice.json` present **will NOT** apply the new system prompt — it resumes the existing session.
- To force re-absorption: `rm .sessions/alice.json` and restart. Alice loses session memory but gets the new prompt on turn 1.

As a less-destructive workaround, you can inject the new instruction via `npm run notify -- alice "New rule: ..."`. The agent sees it as a user message and usually internalises it, though it's weaker than a proper system prompt.

## Turn caps and safety

Every agent has a `MAX_TURNS` env var (default 50). Once that many replies are produced, the agent logs `cap` and stops responding. This is a cost-control guardrail, not a completion signal. Raise it, lower it, or disable it as needed.

Cross-agent crash recovery is manual. There's no supervisor. If an agent goes quiet, check its log file under `logs/<name>.log`, fix the issue, and restart. The queue drains on restart; buffered messages during downtime are lost.
