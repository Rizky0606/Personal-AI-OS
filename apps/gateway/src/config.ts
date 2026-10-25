import { z } from 'zod';

/** String kosong di .env (mis. `HERMES_API_KEY=`) dianggap tidak diisi. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());
const withDefault = <T extends z.ZodType>(schema: T, value: z.input<T>) =>
  z.preprocess(blankToUndefined, schema.default(value as never));

const httpUrl = z.url({ protocol: /^https?$/ });

const EnvSchema = z.object({
  NODE_ENV: withDefault(z.enum(['development', 'test', 'production']), 'development'),
  /** Dengan network_mode host, 0.0.0.0 akan membuka gateway ke publik. Biarkan loopback; nginx yang publik. */
  HOST: withDefault(z.string().min(1), '127.0.0.1'),
  /** Izinkan HOST selain loopback di produksi (mis. di belakang jaringan privat). Bawaan: ditolak. */
  ALLOW_PUBLIC_BIND: withDefault(z.enum(['true', 'false']), 'false'),
  PORT: withDefault(z.coerce.number().int().min(1).max(65535), 3000),
  LOG_LEVEL: withDefault(
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    'info',
  ),
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .describe('postgres://user:password@host:port/db'),
  /** Kunci turunan untuk tanda tangan JWT dan enkripsi secret TOTP. Mengubahnya mencabut semua token dan membuat TOTP perlu didaftarkan ulang (owner:init --reset). */
  AUTH_SECRET: z
    .string()
    .min(32, 'minimal 32 karakter (contoh: openssl rand -base64 48)')
    .describe('rahasia utama autentikasi'),
  HERMES_URL: withDefault(httpUrl, 'http://127.0.0.1:8642'),
  HERMES_API_KEY: optionalString,
  NINEROUTER_URL: withDefault(httpUrl, 'http://127.0.0.1:20128/v1'),
  NINEROUTER_API_KEY: optionalString,
  SEARXNG_URL: withDefault(httpUrl, 'http://127.0.0.1:8888'),
  /** Combo 9Router untuk model kecil. */
  TITLE_MODEL: withDefault(z.string().min(1), 'router-fast'),
  /** Combo 9Router untuk router role (suhu 0, keluaran JSON). */
  ROUTER_MODEL: withDefault(z.string().min(1), 'router-fast'),
  /** Combo 9Router untuk perencanaan dan sintesis laporan riset. */
  RESEARCH_MODEL: withDefault(z.string().min(1), 'research-main'),
  /** Combo 9Router murah untuk meringkas tiap sumber. */
  RESEARCH_SUMMARY_MODEL: withDefault(z.string().min(1), 'general-cheap'),
  /** Chromium/Chrome/Edge untuk halaman yang butuh JavaScript. Kosong = halaman seperti itu dilewati. */
  BROWSER_EXECUTABLE_PATH: optionalString,
  /** Folder kiriman berkas buatan agent seperti terlihat gateway (mis. /outbox). Kosong = fitur mati. */
  OUTBOX_DIR: optionalString,
  /** Folder yang sama seperti terlihat agent di host (mis. /home/ubuntu/aios-outbox). */
  OUTBOX_HOST_DIR: optionalString,
  /** Combo 9Router kecil untuk mengurai jadwal dari bahasa alami. */
  SCHEDULE_MODEL: withDefault(z.string().min(1), 'router-fast'),
  /** Combo 9Router kecil untuk memecah ide menjadi kartu kanban. */
  TASK_MODEL: withDefault(z.string().min(1), 'router-fast'),
  /** Batas run coding yang berjalan bersamaan per project; sisanya mengantre. */
  TASK_MAX_PARALLEL: withDefault(z.coerce.number().int().min(1).max(8), 2),
  /** File service account Firebase (JSON) untuk push FCM. Kosong = push dimatikan. Simpan di secrets/, bukan di repo. */
  FCM_SERVICE_ACCOUNT_FILE: optionalString,
  /** Batas waktu tiap cek dependensi di /readyz. */
  READY_TIMEOUT_MS: withDefault(z.coerce.number().int().min(100).max(10_000), 2000),
});

export type Config = z.infer<typeof EnvSchema>;

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Gagal cepat saat start. Pesan menyebut nama variabel dan alasannya, tidak pernah nilainya. */
export class ConfigError extends Error {
  constructor(readonly issues: { variable: string; message: string }[]) {
    super(
      `Konfigurasi tidak valid:\n${issues.map((i) => `  - ${i.variable}: ${i.message}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) {
    const { data } = parsed;
    // network_mode host + HOST=0.0.0.0 membuka gateway langsung ke internet, melewati nginx dan TLS.
    if (
      data.NODE_ENV === 'production' &&
      data.ALLOW_PUBLIC_BIND !== 'true' &&
      !LOOPBACK.has(data.HOST)
    ) {
      throw new ConfigError([
        {
          variable: 'HOST',
          message:
            'di produksi gateway hanya boleh mendengarkan di loopback (127.0.0.1). Biarkan nginx yang publik, atau isi ALLOW_PUBLIC_BIND=true bila memang disengaja.',
        },
      ]);
    }
    return data;
  }
  throw new ConfigError(
    parsed.error.issues.map((i) => ({
      variable: String(i.path[0] ?? '(env)'),
      message: i.code === 'invalid_type' && i.input === undefined ? 'wajib diisi' : i.message,
    })),
  );
}
