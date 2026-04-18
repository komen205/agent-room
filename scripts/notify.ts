import * as Ably from 'ably';
import { ChatClient } from '@ably/chat';

const [, , to = 'all', ...rest] = process.argv;
const text = rest.join(' ');

if (!text) {
  console.error('Usage: tsx scripts/notify.ts <agent-name|all> <message>');
  process.exit(1);
}

const ROOM_NAME = process.env.ROOM_NAME ?? 'agent-room';
const API_KEY = process.env.ABLY_API_KEY;
if (!API_KEY) {
  console.error('ABLY_API_KEY env var is required');
  process.exit(1);
}

async function main() {
  const realtime = new Ably.Realtime({ key: API_KEY!, clientId: 'operator' });
  const chat = new ChatClient(realtime);
  const room = await chat.rooms.get(ROOM_NAME);
  await room.attach();
  await room.messages.send({ text, metadata: { next: to } });
  console.log(`sent -> ${to}: ${text}`);
  realtime.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
