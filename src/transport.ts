export type TransportMessage = {
  clientId: string;
  text: string;
  metadata?: { next?: string; [key: string]: unknown };
};

export type TransportHandler = (msg: TransportMessage) => void | Promise<void>;

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(handler: TransportHandler): void;
  publish(text: string, metadata?: { next?: string; [key: string]: unknown }): Promise<void>;
}

export type TransportKind = 'ably' | 'nats';

export interface TransportOptions {
  kind: TransportKind;
  room: string;
  clientId: string;
}

export async function createTransport(opts: TransportOptions): Promise<Transport> {
  if (opts.kind === 'ably') {
    const { AblyTransport } = await import('./transport/ably.js');
    return new AblyTransport(opts.room, opts.clientId);
  }
  if (opts.kind === 'nats') {
    const { NatsTransport } = await import('./transport/nats.js');
    return new NatsTransport(opts.room, opts.clientId);
  }
  throw new Error(`Unknown transport kind: ${opts.kind}`);
}

export function resolveTransportKind(): TransportKind {
  const raw = (process.env.TRANSPORT ?? 'ably').toLowerCase();
  if (raw === 'ably' || raw === 'nats') return raw;
  throw new Error(`Invalid TRANSPORT env var: "${raw}". Expected "ably" or "nats".`);
}
