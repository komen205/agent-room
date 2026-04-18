import { loadConfig } from '../src/config.js';
import { createTransport, resolveTransportKind } from '../src/transport.js';

const [, , to = 'all', ...rest] = process.argv;
const text = rest.join(' ');

if (!text) {
  console.error('Usage: tsx scripts/notify.ts <agent-name|all> <message>');
  process.exit(1);
}

async function main() {
  const configFile = process.env.CONFIG_FILE ?? 'config/agents.yaml';
  const { room } = loadConfig(configFile);
  const transportKind = resolveTransportKind();

  const transport = await createTransport({
    kind: transportKind,
    room,
    clientId: 'operator',
  });
  await transport.connect();
  await transport.publish(text, { next: to });
  console.log(`sent (${transportKind}) -> ${to}: ${text}`);
  await transport.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
