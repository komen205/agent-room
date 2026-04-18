import * as Ably from 'ably';
import { ChatClient } from '@ably/chat';
import type { ChatMessageEvent, Room } from '@ably/chat';
import type { Transport, TransportHandler } from '../transport.js';

export class AblyTransport implements Transport {
  private realtime: Ably.Realtime | null = null;
  private chat: ChatClient | null = null;
  private room: Room | null = null;
  private handlers: TransportHandler[] = [];

  constructor(
    private readonly roomName: string,
    private readonly clientId: string,
  ) {}

  async connect(): Promise<void> {
    const apiKey = process.env.ABLY_API_KEY;
    if (!apiKey) throw new Error('ABLY_API_KEY env var is required for the Ably transport');

    this.realtime = new Ably.Realtime({ key: apiKey, clientId: this.clientId });
    this.chat = new ChatClient(this.realtime);
    this.room = await this.chat.rooms.get(this.roomName);
    await this.room.attach();

    this.room.messages.subscribe((event: ChatMessageEvent) => {
      const msg = event.message;
      const payload = {
        clientId: msg.clientId,
        text: msg.text,
        metadata: (msg.metadata ?? {}) as { next?: string; [key: string]: unknown },
      };
      for (const h of this.handlers) {
        Promise.resolve(h(payload)).catch((err) => {
          // swallow — individual handlers own their error reporting
          console.error('[ably transport] handler error', err);
        });
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.realtime) {
      this.realtime.close();
      this.realtime = null;
      this.room = null;
      this.chat = null;
    }
  }

  subscribe(handler: TransportHandler): void {
    this.handlers.push(handler);
  }

  async publish(text: string, metadata?: { next?: string; [key: string]: unknown }): Promise<void> {
    if (!this.room) throw new Error('AblyTransport not connected');
    await this.room.messages.send({ text, metadata });
  }
}
