import type { EngineInfo } from '@aios/contracts';
import { copy } from '../copy';

/** Pilihan pengguna di composer. `auto`: gateway memilih menurut konteks (chat umum = Hermes, project = omp). */
export type EngineChoice = 'auto' | 'omp' | 'hermes' | 'dsh';

export const ENGINE_CHOICES: readonly EngineChoice[] = ['auto', 'omp', 'hermes', 'dsh'];

export interface EngineOption {
  value: EngineChoice;
  label: string;
  /** Alasan nonaktif (dari gateway atau dari konteks), ditampilkan apa adanya. */
  reason?: string;
  disabled: boolean;
  /** Pratinjau: belum diaudit. */
  preview: boolean;
}

export interface EngineView {
  options: EngineOption[];
  /** Pilihan yang berlaku: pilihan tersimpan bila masih bisa dipakai, selain itu Otomatis. */
  effective: EngineChoice;
  /** Mesin yang benar-benar menjawab pesan berikutnya, dipakai untuk kemampuan. */
  engineId: 'hermes' | 'omp' | 'dsh';
  supportsModelPick: boolean;
  supportsTodo: boolean;
}

const LABELS: Record<EngineChoice, string> = {
  auto: copy.chat.engine.auto,
  omp: 'omp',
  hermes: 'Hermes',
  dsh: 'dsh',
};

/**
 * Menghitung pemilih mesin dari laporan gateway dan konteks. omp butuh project; Hermes dan dsh berjalan di chat umum.
 * Mesin yang tidak bisa dipakai tetap tampil, nonaktif dengan alasannya. Sebelum laporan gateway tiba (atau gagal),
 * hanya Otomatis yang bisa dipilih.
 */
export function engineView(
  choice: EngineChoice,
  engines: readonly EngineInfo[] | undefined,
  inProject: boolean,
): EngineView {
  const byId = new Map((engines ?? []).map((engine) => [engine.id, engine]));
  const option = (value: Exclude<EngineChoice, 'auto'>): EngineOption => {
    const info = byId.get(value);
    const contextReason =
      value === 'omp' && !inProject
        ? copy.chat.engine.needsProject
        : value !== 'omp' && inProject
          ? copy.chat.engine.generalOnly
          : undefined;
    const reason =
      contextReason ?? (info?.available ? undefined : (info?.reason ?? copy.chat.engine.unknown));
    return {
      value,
      label: LABELS[value],
      disabled: reason !== undefined,
      ...(reason !== undefined ? { reason } : {}),
      preview: info?.experimental ?? value === 'dsh',
    };
  };
  const options: EngineOption[] = [
    { value: 'auto', label: LABELS.auto, disabled: false, preview: false },
    option('omp'),
    option('hermes'),
    option('dsh'),
  ];
  const chosen = options.find((o) => o.value === choice);
  const effective: EngineChoice = chosen && !chosen.disabled ? choice : 'auto';
  const engineId: EngineView['engineId'] =
    effective === 'auto' ? (inProject ? 'omp' : 'hermes') : effective;
  const info = byId.get(engineId);
  return {
    options,
    effective,
    engineId,
    // Tanpa laporan gateway: Hermes (chat umum) mengunci model, selain itu pemilih model tetap terbuka.
    supportsModelPick: info?.supportsModelPick ?? engineId !== 'hermes',
    supportsTodo: info?.supportsTodo ?? engineId === 'omp',
  };
}

/** Nilai `engine` di permintaan kirim pesan: hanya dsh yang perlu dikirim; yang lain dipilih otomatis oleh konteks. */
export const wireEngine = (effective: EngineChoice): 'dsh' | undefined =>
  effective === 'dsh' ? 'dsh' : undefined;

/** Kunci pilihan untuk chat yang belum punya id percakapan; dipindah ke id sungguhan saat percakapan dibuat. */
export const NEW_CHAT_ENGINE_KEY = 'baru';
const MAX_SAVED_ENGINES = 100;

const isChoice = (value: unknown): value is EngineChoice =>
  typeof value === 'string' && (ENGINE_CHOICES as readonly string[]).includes(value);

/** Menyimpan pilihan satu percakapan. Otomatis = bawaan, jadi dihapus; yang tersisa dibatasi pada yang terbaru. */
export function withEngine(
  saved: Readonly<Record<string, EngineChoice>>,
  key: string,
  choice: EngineChoice,
): Record<string, EngineChoice> {
  const next = { ...saved };
  delete next[key];
  if (choice !== 'auto') next[key] = choice;
  const keys = Object.keys(next);
  return Object.fromEntries(keys.slice(-MAX_SAVED_ENGINES).map((k) => [k, next[k]!]));
}

/** Nilai tersimpan yang rusak atau tidak dikenal dibuang. */
export function parseEngines(value: unknown): Record<string, EngineChoice> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, choice]) => key.length > 0 && isChoice(choice) && choice !== 'auto',
    ),
  );
}
