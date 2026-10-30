import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import { ServerEventSchema } from './events.js';

export const WS_PROTOCOL_VERSION = 1;
export const WS_HEARTBEAT_INTERVAL_MS = 20_000;
/** Batas channel yang boleh dilanggan satu koneksi. */
export const WS_MAX_CHANNELS = 20;
/** Kode penutupan: access token habis atau perangkat dicabut. Klien refresh token lalu sambung ulang. */
export const WS_CLOSE_UNAUTHORIZED = 4401;

/** `user`, `conversation:<id>`, `run:<id>`, atau `team:<id>`. */
export const ChannelSchema = z
  .union([
    z.literal('user'),
    z.templateLiteral(['conversation:', IdSchema]),
    z.templateLiteral(['run:', IdSchema]),
    z.templateLiteral(['team:', IdSchema]),
  ])
  .meta({ id: 'Channel' });
export type Channel = z.infer<typeof ChannelSchema>;

export const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  channel: ChannelSchema,
  /** Seq terakhir yang sudah diterima klien; event setelahnya diputar ulang. */
  lastSeq: z.number().int().nonnegative().optional(),
});

export const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  channel: ChannelSchema,
});

export const PingMessageSchema = z.object({ type: z.literal('ping') });

export const ClientMessageSchema = z
  .discriminatedUnion('type', [SubscribeMessageSchema, UnsubscribeMessageSchema, PingMessageSchema])
  .meta({ id: 'WsClientMessage' });
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Envelope event dari server. `seq` naik per channel. */
export const EventEnvelopeSchema = z
  .object({
    v: z.literal(WS_PROTOCOL_VERSION),
    channel: ChannelSchema,
    seq: z.number().int().positive(),
    ts: TimestampSchema,
    event: ServerEventSchema,
  })
  .meta({ id: 'EventEnvelope' });
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const PongMessageSchema = z.object({ type: z.literal('pong') });

/**
 * Balasan atas `subscribe`, dikirim sebelum event replay. `lastSeq` adalah seq terbaru yang
 * tersimpan saat itu (0 bila channel tidak punya log, yaitu `user` dan `conversation:*`).
 */
export const SubscribedMessageSchema = z.object({
  type: z.literal('subscribed'),
  channel: ChannelSchema,
  lastSeq: z.number().int().nonnegative(),
  /** false pada channel yang hanya live (tanpa replay dari database). */
  replay: z.boolean(),
});

/** Kesalahan protokol WebSocket. Koneksi tetap terbuka kecuali disebut lain. */
export const WsErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.enum(['invalid_message', 'not_found', 'too_many_channels']),
  message: z.string(),
  channel: ChannelSchema.optional(),
});

export const ServerMessageSchema = z.union([
  EventEnvelopeSchema,
  PongMessageSchema,
  SubscribedMessageSchema,
  WsErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
