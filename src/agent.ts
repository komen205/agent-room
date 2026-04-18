import * as Ably from 'ably';
import { ChatClient } from '@ably/chat';
import type { ChatMessageEvent } from '@ably/chat';
import { spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { loadConfig, type Role } from './config.js';

const NAME = process.env.NAME;
if (!NAME) throw new Error('NAME env var is required');

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

function ask(incoming: string, currentRole: Role): Promise<string> {
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
    let buffer = '';
    let finalResult = '';

    log('start', 'thinking...');

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
              } else if (block.type === 'tool_use') {
                const input = JSON.stringify(block.input ?? {}).slice(0, 120);
                log('tool', `${block.name}(${input})`);
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

    proc.on('close', (code) => {
      if (code === 0) resolvePromise(finalResult.trim());
      else rejectPromise(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', rejectPromise);
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
  log('boot', `role=${role.kind} cwd=${role.cwd} nextSpeaker=${role.nextSpeaker} room=${ROOM_NAME}`);

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) throw new Error('ABLY_API_KEY env var is required');

  const realtime = new Ably.Realtime({ key: apiKey, clientId: NAME });
  const chat = new ChatClient(realtime);
  const chatRoom = await chat.rooms.get(ROOM_NAME);
  await chatRoom.attach();

  const listenAll = role.kind === 'reviewer' || role.kind === 'scout';
  const canNoop = role.kind === 'reviewer' || role.kind === 'scout';

  let busy = false;
  const queue: ChatMessageEvent[] = [];

  const handle = async (event: ChatMessageEvent): Promise<void> => {
    const msg = event.message;
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
      const reply = await ask(prompt, role);

      if (canNoop && /^\s*NOOP\s*$/i.test(reply)) {
        log('noop', `silent on ${msg.clientId}'s last message`);
        return;
      }

      turnsTaken++;
      const next = resolveNext(msg);
      log('send', `-> ${next}: ${reply.slice(0, 200)}`);
      await chatRoom.messages.send({ text: reply, metadata: { next } });
    } finally {
      busy = false;
      const nextEvent = queue.shift();
      if (nextEvent) {
        log('queue', `processing queued message (${queue.length} remaining)`);
        handle(nextEvent).catch((err) => log('err', `queued handler failed: ${err}`));
      }
    }
  };

  chatRoom.messages.subscribe((event: ChatMessageEvent) => {
    if (busy) {
      if (queue.length >= 10) queue.shift();
      queue.push(event);
      log('queue', `queued from ${event.message.clientId} (depth ${queue.length})`);
      return;
    }
    handle(event).catch((err) => log('err', `handler failed: ${err}`));
  });

  if (role.opener) {
    const delayMs = role.kind === 'scout' ? 10000 : 5000;
    await new Promise((r) => setTimeout(r, delayMs));
    log('opener', `running opener prompt (delay=${delayMs}ms)`);
    const opener = await ask(role.opener, role);
    turnsTaken++;
    const next = role.kind === 'reviewer' ? 'all' : resolveNext({ clientId: 'system' });
    log('send', `-> ${next}: ${opener.slice(0, 200)}`);
    await chatRoom.messages.send({ text: opener, metadata: { next } });
  }
}

run().catch((err) => {
  console.error(`[${NAME}] fatal:`, err);
  process.exit(1);
});
