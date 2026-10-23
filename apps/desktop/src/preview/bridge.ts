import { z } from 'zod';

/** Pesan dari skrip jembatan di dalam halaman preview (lihat apps/worker/src/preview/bridge.ts). */
const ConsoleMessage = z.object({
  aios: z.literal('preview'),
  type: z.literal('console'),
  level: z.string(),
  text: z.string(),
});

const PickMessage = z.object({
  aios: z.literal('preview'),
  type: z.literal('pick'),
  selector: z.string().min(1),
  html: z.string(),
  text: z.string(),
  styles: z.record(z.string(), z.string()),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  viewport: z.object({ width: z.number(), height: z.number() }),
  url: z.string(),
});

const InspectMessage = z.object({
  aios: z.literal('preview'),
  type: z.literal('inspect'),
  on: z.boolean(),
});

const ReadyMessage = z.object({
  aios: z.literal('preview'),
  type: z.literal('ready'),
  url: z.string(),
});

const BridgeMessageSchema = z.discriminatedUnion('type', [
  ConsoleMessage,
  PickMessage,
  InspectMessage,
  ReadyMessage,
]);
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
export type PickMessageData = z.infer<typeof PickMessage>;

/** Pesan yang bentuknya salah dibuang diam-diam: halaman preview adalah kode pihak lain. */
export function parseBridgeMessage(data: unknown): BridgeMessage | undefined {
  const parsed = BridgeMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/** Perintah ke jembatan di dalam iframe. */
export const inspectCommand = (on: boolean) => ({ aios: 'preview-cmd', cmd: 'inspect', on });
