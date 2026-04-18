import { createTransport, resolveTransportKind } from '../src/transport.js';

const [, , to = 'all', ...rest] = process.argv;
const text = rest.join(' ');

if (!text) {
  console.error('Usage: tsx scripts/notify.ts <agent-name|all> <message>');
  console.error('');
  console.error('Room is read from ROOM env var; falls back to config file at CONFIG_FILE');
  console.error('(default config/agents.yaml) if ROOM is unset.');
  process.exit(1);
}

async function resolveRoom(): Promise<string> {
  if (process.env.ROOM) return process.env.ROOM;
  const { loadConfig } = await import('../src/config.js');
  const configFile = process.env.CONFIG_FILE ?? 'config/agents.yaml';
  return loadConfig(configFile).room;
}

async function main() {
  const room = await resolveRoom();
  const transportKind = resolveTransportKind();

  const transport = await createTransport({
    kind: transportKind,
    room,
    clientId: 'operator',
  });
  await transport.connect();
  await transport.publish(text, { next: to });
  console.log(`sent (${transportKind}, room=${room}) -> ${to}: ${text}`);
  await transport.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
