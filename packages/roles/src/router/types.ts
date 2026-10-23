import type { RouteDecisionSchema, Surface } from '@aios/contracts';
import type { z } from 'zod';

export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export interface RouterProject {
  name: string;
  /** Stack yang terdeteksi dari file manifest, mis. "typescript, react". */
  stack?: string | undefined;
}

export interface RouterHistoryItem {
  author: 'user' | 'assistant';
  text: string;
}

/** Koreksi pemilik: pesan ini seharusnya ke `toRole`, bukan `fromRole`. */
export interface RouterCorrection {
  fromRole: string;
  toRole: string;
  excerpt: string;
}

export interface RouterInput {
  message: string;
  surface: Surface;
  /** Project aktif pada percakapan; tanpa project hanya role grup Umum yang boleh dipilih. */
  project?: RouterProject | undefined;
  /** Role pada giliran sebelumnya. */
  previousRole?: string | undefined;
  /** 3–5 pesan sebelumnya, dari yang terlama. */
  history?: RouterHistoryItem[] | undefined;
  /** Koreksi terbaru (maks. 20 dipakai). */
  corrections?: RouterCorrection[] | undefined;
  /** Pilihan pemilik (chip role); mengalahkan semua aturan lain. */
  manualRole?: string | undefined;
}

/**
 * `manual`: dipilih pemilik. `rule`: aturan cepat tanpa model. `ai`: model router.
 * `fallback`: model gagal atau keluarannya tidak valid, jadi `general`.
 */
export type RouteSource = 'manual' | 'rule' | 'ai' | 'fallback';

export interface RouteResult {
  decision: RouteDecision;
  source: RouteSource;
  /** Nama aturan cepat yang menentukan (source = rule). */
  rule?: string;
  /** Berapa kali model dipanggil (0 untuk manual dan aturan cepat). */
  attempts: number;
  latencyMs: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Memanggil model router (combo router-fast). Pemanggil menetapkan model; suhu selalu 0. */
export type Complete = (request: {
  messages: ChatMessage[];
  temperature: 0;
  signal?: AbortSignal | undefined;
}) => Promise<string>;
