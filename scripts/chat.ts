/**
 * Interactive operator chat.
 *
 * Runs a long-lived connection to the transport:
 *   - Subscribes: every message from any agent prints to the terminal in real time.
 *   - stdin: each line you type is published as an operator message, addressed
 *     to the target agent (first CLI arg, default "all").
 *
 * Usage:
 *   npm run chat -- emulator
 *
 * Environment:
 *   TRANSPORT=nats|ably (default ably)
 *   ROOM=<room-name>   (required, or falls back to CONFIG_FILE's agents.yaml room)
 *   NATS_URL=...       (for NATS)
 *   ABLY_API_KEY=...   (for Ably)
 *
 * Special commands (typed as the line content, no prefix):
 *   /to <name>        — change the default addressee for subsequent lines
 *   /quit or /exit    — disconnect and exit
 *   /clear            — clear the terminal
 */

import { createInterface } from 'readline';
import { createTransport, resolveTransportKind, type TransportMessage } from '../src/transport.js';

const args = process.argv.slice(2);
let target = args[0] ?? 'all';

async function resolveRoom(): Promise<string> {
  if (process.env.ROOM) return process.env.ROOM;
  const { loadConfig } = await import('../src/config.js');
  const configFile = process.env.CONFIG_FILE ?? 'config/agents.yaml';
  return loadConfig(configFile).room;
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function colour(clientId: string): string {
  // simple deterministic colour by clientId
  const palette = ['\x1b[36m', '\x1b[32m', '\x1b[33m', '\x1b[35m', '\x1b[34m', '\x1b[31m'];
  const i = Array.from(clientId).reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return palette[i];
}
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

async function main() {
  const room = await resolveRoom();
  const kind = resolveTransportKind();
  const transport = await createTransport({ kind, room, clientId: 'operator' });
  await transport.connect();

  console.log(`${DIM}connected · transport=${kind} · room=${room} · target=${target}${RESET}`);
  console.log(`${DIM}type a message + Enter to send. prefix with '!' to INTERRUPT the agent's current turn.${RESET}`);
  console.log(`${DIM}/to <name> to retarget. /clear to clear. /quit to exit.${RESET}`);
  console.log('');

  transport.subscribe((msg: TransportMessage) => {
    if (msg.clientId === 'operator') return; // don't echo our own sends
    const c = colour(msg.clientId);
    const kind = (msg.metadata?.kind ?? 'reply') as string;
    const text = msg.text;

    if (kind === 'start') {
      console.log(`${DIM}${ts()} ${c}[${msg.clientId}]${RESET} ${DIM}…thinking${RESET}`);
      return;
    }
    if (kind === 'tool') {
      const toolName = (msg.metadata?.tool as string) ?? 'tool';
      console.log(`${DIM}${ts()}${RESET} \x1b[90m  ├─ ${c}${toolName}${RESET}\x1b[90m  ${text.slice(toolName.length + 1, 500)}${RESET}`);
      return;
    }
    if (kind === 'txt') {
      // intermediate text (the agent thinking out loud in a text block before a tool call)
      console.log(`${DIM}${ts()}${RESET} \x1b[90m  ├─ ${text.slice(0, 300)}${RESET}`);
      return;
    }
    if (kind === 'thinking') {
      console.log(`${DIM}${ts()}${RESET} \x1b[90m  ├─ 💭 ${text.slice(0, 200)}${RESET}`);
      return;
    }
    // kind === 'reply' (the final message)
    const addressed = msg.metadata?.next ? ` -> ${msg.metadata.next}` : '';
    console.log(`${DIM}${ts()}${RESET} ${c}[${msg.clientId}${addressed}]${RESET} ${text}`);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.setPrompt(`${DIM}>${RESET} `);
  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (trimmed === '/quit' || trimmed === '/exit') {
      rl.close();
      return;
    }
    if (trimmed === '/clear') {
      console.clear();
      rl.prompt();
      return;
    }
    if (trimmed.startsWith('/to ')) {
      target = trimmed.slice(4).trim() || 'all';
      console.log(`${DIM}target → ${target}${RESET}`);
      rl.prompt();
      return;
    }
    try {
      await transport.publish(trimmed, { next: target });
      console.log(`${DIM}${ts()}${RESET} \x1b[90m[you -> ${target}]${RESET} ${trimmed}`);
    } catch (err) {
      console.error(`${DIM}publish failed:${RESET}`, err);
    }
    rl.prompt();
  });

  rl.on('close', async () => {
    console.log(`${DIM}disconnecting…${RESET}`);
    await transport.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
