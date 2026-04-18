import { connect, type NatsConnection, type Subscription, StringCodec } from 'nats';
import type { Transport, TransportHandler, TransportMessage } from '../transport.js';

/**
 * NATS transport.
 *
 * Every agent in a room subscribes to the same subject and publishes to it.
 * The subject is `agent-room.<roomName>`. The envelope schema:
 *
 *   {
 *     "clientId": "reviewer",
 *     "text": "...",
 *     "metadata": { "next": "implementer-a" }
 *   }
 *
 * Publishers stamp the envelope with their own clientId. Subscribers filter
 * out their own messages (same-clientId echoes).
 */
export class NatsTransport implements Transport {
  private nc: NatsConnection | null = null;
  private sub: Subscription | null = null;
  private handlers: TransportHandler[] = [];
  private readonly codec = StringCodec();
  private readonly subject: string;

  constructor(roomName: string, private readonly clientId: string) {
    this.subject = `agent-room.${roomName}`;
  }

  async connect(): Promise<void> {
    const url = process.env.NATS_URL ?? 'nats://localhost:4222';
    const user = process.env.NATS_USER;
    const pass = process.env.NATS_PASS;
    const token = process.env.NATS_TOKEN;

    this.nc = await connect({
      servers: url,
      name: `agent-room:${this.clientId}`,
      user,
      pass,
      token,
      reconnect: true,
      maxReconnectAttempts: -1, // retry forever
      reconnectTimeWait: 1000,
    });

    this.sub = this.nc.subscribe(this.subject);
    (async () => {
      for await (const m of this.sub!) {
        let envelope: TransportMessage;
        try {
          envelope = JSON.parse(this.codec.decode(m.data));
        } catch (err) {
          console.error('[nats transport] malformed message, dropping:', err);
          continue;
        }
        for (const h of this.handlers) {
          Promise.resolve(h(envelope)).catch((err) => {
            console.error('[nats transport] handler error', err);
          });
        }
      }
    })();
  }

  async disconnect(): Promise<void> {
    if (this.sub) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
    }
  }

  subscribe(handler: TransportHandler): void {
    this.handlers.push(handler);
  }

  async publish(text: string, metadata?: { next?: string; [key: string]: unknown }): Promise<void> {
    if (!this.nc) throw new Error('NatsTransport not connected');
    const envelope: TransportMessage = {
      clientId: this.clientId,
      text,
      metadata: metadata ?? {},
    };
    this.nc.publish(this.subject, this.codec.encode(JSON.stringify(envelope)));
  }
}
