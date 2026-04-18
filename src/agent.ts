import { spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { loadConfig, type Role } from './config.js';
import { createTransport, resolveTransportKind, type TransportMessage } from './transport.js';

const NAME: string = (() => {
  const n = process.env.NAME;
  if (!n) throw new Error('NAME env var is required');
  return n;
})();

const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? '50', 10);
const CONFIG_FILE = process.env.CONFIG_FILE ?? 'config/agents.yaml';
const SESSION_FILE = resolve(`.sessions/${NAME}.json`);
const LOG_FILE = resolve(`logs/${NAME}.log`);
mkdirSync(dirname(LOG_FILE), { recursive: true });

const { room: ROOM_NAME, roles } = loadConfig(CONFIG_FILE);
const role = roles[NAME];
if (!role) {
  throw new Error(`Unknown NAME: ${NAME}. Must be one of: ${Object.keys(roles).join(', ')}`);
}

type State = { sessionId: string | null };

function loadState(): State {
  if (!existsSync(SESSION_FILE)) return { sessionId: null };
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return { sessionId: null };
  }
}

function saveState(state: State) {
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
}

let { sessionId } = loadState();
let turnsTaken = 0;

function log(kind: string, text: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] [${NAME}·${kind}] ${text}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}

export type TraceEvent =
  | { kind: 'start' }
  | { kind: 'txt'; text: string }
  | { kind: 'tool'; name: string; input: string }
  | { kind: 'thinking'; text: string };

// Exposed so the subscribe handler can kill it when the operator
// sends an interrupt-prefixed ('!') message while the agent is busy.
let currentProc: ReturnType<typeof spawn> | null = null;

function ask(
  incoming: string,
  currentRole: Role,
  onTrace?: (ev: TraceEvent) => void,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      '-p', incoming,
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--add-dir', currentRole.cwd,
    ];
    if (sessionId) args.push('--resume', sessionId);
    else args.push('--append-system-prompt', currentRole.system);

    const proc = spawn('claude', args, {
      cwd: currentRole.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    currentProc = proc;
    let buffer = '';
    let finalResult = '';

    log('start', 'thinking...');
    onTrace?.({ kind: 'start' });

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.session_id) sessionId = msg.session_id;
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                log('txt', block.text.slice(0, 200));
                onTrace?.({ kind: 'txt', text: block.text });
              } else if (block.type === 'tool_use') {
                const input = JSON.stringify(block.input ?? {});
                log('tool', `${block.name}(${input.slice(0, 120)})`);
                onTrace?.({ kind: 'tool', name: block.name, input: input.slice(0, 2000) });
              } else if (block.type === 'thinking' && block.thinking) {
                log('think', block.thinking.slice(0, 200));
                onTrace?.({ kind: 'thinking', text: block.thinking });
              }
            }
          }
          if (msg.type === 'result') {
            finalResult = msg.result ?? '';
            sessionId = msg.session_id ?? sessionId;
            saveState({ sessionId });
          }
        } catch {
          // non-JSON line, ignore
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[${NAME}·err] ${chunk}`);
    });

    proc.on('close', (code, signal) => {
      if (currentProc === proc) currentProc = null;
      if (code === 0) resolvePromise(finalResult.trim());
      else rejectPromise(new Error(`claude exited with code ${code ?? signal}`));
    });
    proc.on('error', (err) => {
      if (currentProc === proc) currentProc = null;
      rejectPromise(err);
    });
  });
}

function resolveNext(msg: { clientId: string }): string {
  return role.nextSpeaker === 'sender' ? msg.clientId : role.nextSpeaker;
}

function buildPerTurnPrompt(msg: { clientId: string; text: string }): string {
  const prUrlMatch = msg.text.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)\/pull\/(\d+)/i);

  if (role.kind === 'reviewer') {
    if (prUrlMatch) {
      const [, owner, repo, num] = prUrlMatch;
      return `${msg.clientId} just posted a PR URL:

"${msg.text}"

MANDATORY: review this PR now. Do ALL of:
1. Run: gh pr view ${num} --repo ${owner}/${repo} --json title,body,baseRefName,headRefName,files,additions,deletions
2. Run: gh pr diff ${num} --repo ${owner}/${repo}
3. Verify the diff matches what was discussed in chat. Check for: scope creep, skipped tests, sloppy commits, broken typecheck, vague PR description, over-broad changes.
4. If solid, post approval: gh pr review ${num} --repo ${owner}/${repo} --approve --body "<2-3 sentence reason>" — then in chat tell ${msg.clientId} to move to the next work item.
5. If flawed, post changes requested: gh pr review ${num} --repo ${owner}/${repo} --request-changes --body "<specific, file/line critique>" — then in chat tell ${msg.clientId} exactly what to fix.

Do NOT output NOOP. PR review is mandatory. Reply with your decision and actions taken.`;
    }
    return `${msg.clientId} just said in the group chat:

"${msg.text}"

Decide now: does this message require your intervention? If it is rigorous, on-track, and moving toward a concrete deliverable — output exactly: NOOP.

Otherwise, respond with a critique addressed to ${msg.clientId}: name the specific flaw, cite files/lines or PR/commit refs, give a concrete next step.`;
  }

  if (role.kind === 'scout') {
    return `${msg.clientId} just said:

"${msg.text}"

You are a scout — you respond when directly addressed to run a scan, or when a prior finding needs follow-up. If the message is not addressed to you and no follow-up is needed, output exactly: NOOP.

Otherwise: run the requested scan (or the next pattern from your mental list), find concrete issues with file/line citations, file them according to the workflow in your system prompt, and post a 3-5 sentence summary addressed to ${msg.clientId}.`;
  }

  // executor
  return `${msg.clientId} just said in the group chat:

"${msg.text}"

Respond as ${NAME}. Follow your system prompt's workflow strictly.`;
}

async function run() {
  log('boot', sessionId ? `resuming claude session ${sessionId}` : 'no saved session, will start fresh');
  const transportKind = resolveTransportKind();
  const readRoomsList = role.readRooms.length ? ` reads=[${role.readRooms.join(',')}]` : '';
  log('boot', `role=${role.kind} transport=${transportKind} room=${ROOM_NAME}${readRoomsList} cwd=${role.cwd} nextSpeaker=${role.nextSpeaker}`);

  const transport = await createTransport({
    kind: transportKind,
    room: ROOM_NAME,
    clientId: NAME,
  });
  await transport.connect();

  const listenAll = role.kind === 'reviewer' || role.kind === 'scout';
  const canNoop = role.kind === 'reviewer' || role.kind === 'scout';

  let busy = false;
  const queue: TransportMessage[] = [];

  /**
   * Gate every incoming message through this. Two behaviours:
   *
   * 1. Drop self-messages at the edge (NATS/Ably deliver our own publishes back
   *    to us; we never want to queue or handle them). This prevents the agent's
   *    own trace stream from rolling over the queue every few seconds.
   * 2. Priority lane for operator messages — they go to the FRONT of the queue
   *    so human-in-the-loop instructions are processed before any pending
   *    agent-to-agent chatter.
   */
  const enqueueOrHandle = (msg: TransportMessage, sourceTag: string) => {
    if (msg.clientId === NAME) return; // drop self

    // Operator interrupt: a message starting with '!' kills the in-flight
    // claude subprocess so the operator instruction is processed next turn.
    // The leading '!' is stripped before the message enters the queue.
    const isInterrupt =
      msg.clientId === 'operator' && msg.text.trim().startsWith('!');
    if (isInterrupt) {
      const stripped = msg.text.trim().replace(/^!\s*/, '');
      msg = { ...msg, text: stripped };
      if (busy && currentProc && !currentProc.killed) {
        log('interrupt', `operator '!' prefix → killing subprocess pid=${currentProc.pid}`);
        currentProc.kill('SIGKILL');
        // Do not return — fall through to queue the stripped message so it's
        // processed as soon as the dying subprocess's finally block releases
        // `busy`.
      } else {
        log('interrupt', 'operator used `!` prefix but agent is not busy; handling normally');
      }
    }

    if (busy) {
      // Queue full? Evict the oldest NON-operator message so priority messages
      // never evict each other. If the whole queue is priority (rare), fall
      // back to shifting from the front.
      if (queue.length >= 10) {
        const nonOperatorIdx = queue.findIndex((m) => m.clientId !== 'operator');
        if (nonOperatorIdx >= 0) {
          queue.splice(nonOperatorIdx, 1);
        } else {
          queue.shift(); // all priority, drop oldest priority
          log('queue', `WARN: queue saturated with operator messages, dropping oldest priority`);
        }
      }
      if (msg.clientId === 'operator') {
        queue.unshift(msg);
        log('queue', `[priority${isInterrupt ? '+interrupt' : ''}] queued from operator${sourceTag} (depth ${queue.length})`);
      } else {
        queue.push(msg);
        log('queue', `queued from ${msg.clientId}${sourceTag} (depth ${queue.length})`);
      }
      return;
    }
    handle(msg).catch((err) => log('err', `handler failed${sourceTag}: ${err}`));
  };

  // Extra read-only subscriptions for rooms the agent observes without publishing.
  const readOnlyTransports: Array<{ disconnect: () => Promise<void> }> = [];
  for (const extraRoom of role.readRooms) {
    const t = await createTransport({ kind: transportKind, room: extraRoom, clientId: NAME });
    await t.connect();
    t.subscribe((msg) => enqueueOrHandle(msg, `@${extraRoom}`));
    readOnlyTransports.push(t);
    log('boot', `subscribed to readRoom=${extraRoom}`);
  }

  const handle = async (msg: TransportMessage): Promise<void> => {
    const meta = (msg.metadata ?? {}) as { next?: string };

    if (msg.clientId === NAME) return;
    if (!listenAll && meta.next && meta.next !== NAME && meta.next !== 'all') return;

    if (turnsTaken >= MAX_TURNS) {
      log('cap', `turn cap (${MAX_TURNS}) reached`);
      return;
    }

    busy = true;

    try {
      log('recv', `from ${msg.clientId}: ${msg.text.slice(0, 200)}`);
      const prompt = buildPerTurnPrompt(msg);
      const traceTarget = msg.clientId; // stream trace to whoever pinged us
      const reply = await ask(prompt, role, (ev) => {
        publishTrace(transport, traceTarget, ev).catch((err) =>
          log('err', `trace publish failed: ${err}`),
        );
      });

      if (canNoop && /^\s*NOOP\s*$/i.test(reply)) {
        log('noop', `silent on ${msg.clientId}'s last message`);
        return;
      }

      turnsTaken++;
      const next = resolveNext(msg);
      log('send', `-> ${next}: ${reply.slice(0, 200)}`);
      await transport.publish(reply, { next, kind: 'reply' });
    } finally {
      busy = false;
      const nextEvent = queue.shift();
      if (nextEvent) {
        log('queue', `processing queued message (${queue.length} remaining)`);
        handle(nextEvent).catch((err) => log('err', `queued handler failed: ${err}`));
      }
    }
  };

  transport.subscribe((msg) => enqueueOrHandle(msg, ''));

  if (role.opener) {
    const delayMs = role.kind === 'scout' ? 10000 : 5000;
    await new Promise((r) => setTimeout(r, delayMs));
    log('opener', `running opener prompt (delay=${delayMs}ms)`);
    const next = role.kind === 'reviewer' ? 'all' : resolveNext({ clientId: 'system' });
    const opener = await ask(role.opener, role, (ev) => {
      publishTrace(transport, next, ev).catch((err) =>
        log('err', `trace publish failed: ${err}`),
      );
    });
    turnsTaken++;
    log('send', `-> ${next}: ${opener.slice(0, 200)}`);
    await transport.publish(opener, { next, kind: 'reply' });
  }
}

async function publishTrace(
  transport: { publish: (text: string, metadata?: { next?: string; [key: string]: unknown }) => Promise<void> },
  next: string,
  ev: TraceEvent,
): Promise<void> {
  switch (ev.kind) {
    case 'start':
      await transport.publish('…thinking', { next, kind: 'start' });
      return;
    case 'tool':
      await transport.publish(`${ev.name}(${ev.input})`, { next, kind: 'tool', tool: ev.name });
      return;
    case 'txt':
      await transport.publish(ev.text, { next, kind: 'txt' });
      return;
    case 'thinking':
      await transport.publish(ev.text, { next, kind: 'thinking' });
      return;
  }
}

run().catch((err) => {
  console.error(`[${NAME}] fatal:`, err);
  process.exit(1);
});
