import { copy } from '../copy';
import { isSettled, type LiveRun, type ToolStep } from './liveRun';

/**
 * Lapisan data aktivitas run (tanpa React, tanpa jam): mengubah `LiveRun` menjadi apa yang ditampilkan baris
 * progres: judul abu, aksi saat ini dalam kalimat manusiawi, penghitung waktu, jumlah langkah, dan ringkasan.
 * Waktu "sekarang" selalu dari pemanggil, jadi fungsi ini murni dan bisa diuji dengan fixture emas
 * (packages/contracts/fixtures/activity) yang sama dengan Android.
 */

export type ActivityPhase =
  'idle' | 'thinking' | 'tool' | 'writing' | 'waiting_approval' | 'done' | 'error' | 'cancelled';

export interface ActivityStep {
  id: string;
  /** Kalimat langkah menurut status: berjalan, selesai, atau "<kata benda> gagal/ditolak/dibatalkan". */
  label: string;
  /** Path, URL, atau perintah (dipotong), dipisah dari kalimat supaya bisa ditampilkan redup. */
  target?: string;
  status: ToolStep['status'];
  /** Selesai: durasi dari mesin. Berjalan: sejak mulai (null bila waktu mulai tak diketahui). */
  durationMs: number | null;
  startedAt: number | null;
}

export interface ActivityCurrent {
  label: string;
  target?: string;
  /** Jumlah tool yang berjalan bersamaan (1 bila tunggal); yang ditampilkan adalah yang terbaru dimulai. */
  parallel: number;
}

export interface Activity {
  headline: string | null;
  phase: ActivityPhase;
  current: ActivityCurrent | null;
  stepCount: number;
  /** Langkah di luar `visibleSteps` terbaru (bawaan 3). */
  hiddenCount: number;
  elapsedMs: number;
  steps: ActivityStep[];
  summary: string | null;
  needsAttention: boolean;
}

export interface ActivityOptions {
  visibleSteps?: number;
}

export const DEFAULT_VISIBLE_STEPS = 3;
export const HEADLINE_MAX = 80;
export const TARGET_MAX = 60;

type ToolKind = keyof typeof copy.runActivity.tools;

/** Nama tool (huruf kecil) → jenis. omp: bash, write, todo, task terverifikasi rekaman; sisanya dari daftar tool omp/Hermes. */
const TOOL_KINDS: Record<string, ToolKind> = {
  bash: 'command',
  sh: 'command',
  shell: 'command',
  terminal: 'command',
  exec: 'command',
  execute: 'command',
  execute_code: 'command',
  run_command: 'command',
  command: 'command',
  powershell: 'command',
  edit: 'edit',
  write: 'edit',
  write_file: 'edit',
  patch: 'edit',
  apply_patch: 'edit',
  str_replace: 'edit',
  str_replace_editor: 'edit',
  multiedit: 'edit',
  notebook: 'edit',
  delete: 'edit',
  rm: 'edit',
  read: 'read',
  read_file: 'read',
  view: 'read',
  cat: 'read',
  open_file: 'read',
  grep: 'search',
  search: 'search',
  search_files: 'search',
  find: 'search',
  glob: 'search',
  ripgrep: 'search',
  rg: 'search',
  lsp: 'search',
  web_search: 'web',
  websearch: 'web',
  search_web: 'web',
  fetch: 'web',
  web_fetch: 'web',
  fetch_url: 'web',
  web: 'web',
  browser: 'browser',
  task: 'subagent',
  delegate_task: 'subagent',
  subagent: 'subagent',
  todo: 'plan',
  todowrite: 'plan',
  todo_write: 'plan',
};

function kindOf(name: string): ToolKind | null {
  const key = name.trim().toLowerCase();
  if (Object.hasOwn(TOOL_KINDS, key)) return TOOL_KINDS[key] ?? null;
  if (key.startsWith('browser_')) return 'browser';
  return null;
}

/** Kalimat langkah menurut jenis tool dan status. */
function stepLabel(name: string, status: ToolStep['status']): string {
  const t = copy.runActivity;
  const kind = kindOf(name);
  if (status === 'running')
    return kind ? t.tools[kind].running : t.unknownTool.running(name.trim());
  if (status === 'ok') return kind ? t.tools[kind].done : t.unknownTool.done(name.trim());
  const noun = kind ? t.tools[kind].noun : t.unknownTool.noun(name.trim());
  return `${noun} ${t.statusSuffix[status]}`;
}

/** Satu baris, spasi dipadatkan, maks 60 karakter: path memotong awal (nama berkas tetap terlihat), lainnya akhir. */
export function truncateTarget(target: string): string {
  const line = target
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  const flat = (line ?? '').replace(/\s+/g, ' ');
  if (flat.length <= TARGET_MAX) return flat;
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(flat);
  const isPath = !isUrl && !flat.includes(' ') && /[\\/]/.test(flat);
  return isPath
    ? `…${flat.slice(flat.length - (TARGET_MAX - 1))}`
    : `${flat.slice(0, TARGET_MAX - 1)}…`;
}

/** Membersihkan satu baris dari penanda markdown. */
function stripMarkdown(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Judul dari penalaran: baris pertama yang bermakna, sampai akhir kalimat pertama, maks 80 karakter. */
function headlineFrom(reasoning: string): string | null {
  for (const raw of reasoning.split('\n')) {
    const line = stripMarkdown(raw);
    if (line === '') continue;
    const end = /[.!?](?=\s|$)/.exec(line);
    const sentence = (end ? line.slice(0, end.index) : line).trim();
    if (sentence === '') continue;
    return sentence.length > HEADLINE_MAX
      ? `${sentence.slice(0, HEADLINE_MAX - 1).trimEnd()}…`
      : sentence;
  }
  return null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * "8 dtk", "1 mnt 05 dtk", "6 mnt 24 dtk", "1 j 02 mnt". Detik dipotong ke bawah (floor) agar penghitung
 * tidak mendahului waktu nyata; di atas 1 jam detik dibuang dan menit juga dipotong ke bawah.
 */
export function formatElapsed(ms: number): string {
  const u = copy.runActivity.units;
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (total < 60) return `${total} ${u.second}`;
  if (total < 3600) return `${Math.floor(total / 60)} ${u.minute} ${pad2(total % 60)} ${u.second}`;
  return `${Math.floor(total / 3600)} ${u.hour} ${pad2(Math.floor((total % 3600) / 60))} ${u.minute}`;
}

function phaseOf(live: LiveRun, running: ToolStep[]): ActivityPhase {
  switch (live.status) {
    case 'completed':
    case 'needs_review':
    case 'accepted':
    case 'rejected':
      return 'done';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      break;
  }
  if (live.status === 'waiting_approval' || live.approvals.length > 0) return 'waiting_approval';
  if (running.length > 0) return 'tool';
  if (live.lastActivity === 'text') return 'writing';
  if (live.lastActivity !== null) return 'thinking';
  return live.status === 'running' ? 'thinking' : 'idle';
}

export function buildActivity(live: LiveRun, now: number, options: ActivityOptions = {}): Activity {
  const visible = options.visibleSteps ?? DEFAULT_VISIBLE_STEPS;
  const running = live.tools.filter((t) => t.status === 'running');
  const phase = phaseOf(live, running);

  const steps: ActivityStep[] = live.tools.map((t) => ({
    id: t.id,
    label: stepLabel(t.name, t.status),
    ...(t.target ? { target: truncateTarget(t.target) } : {}),
    status: t.status,
    durationMs:
      t.status === 'running'
        ? t.startedAt === null
          ? null
          : Math.max(0, now - t.startedAt)
        : (t.durationMs ?? null),
    startedAt: t.startedAt,
  }));

  // Yang terbaru dimulai; waktu sama atau tak diketahui: yang datang belakangan.
  const newest = running.reduce<ToolStep | undefined>(
    (best, t) =>
      best === undefined || (t.startedAt ?? -Infinity) >= (best.startedAt ?? -Infinity) ? t : best,
    undefined,
  );
  const current: ActivityCurrent | null = newest
    ? {
        label: stepLabel(newest.name, 'running'),
        ...(newest.target ? { target: truncateTarget(newest.target) } : {}),
        parallel: running.length,
      }
    : null;

  const settled = isSettled(live.status);
  const end = live.endedAt ?? (settled ? (live.lastEventAt ?? live.startedAt) : now);
  const elapsedMs = live.startedAt === null || end === null ? 0 : Math.max(0, end - live.startedAt);

  const t = copy.runActivity.summary;
  const label =
    phase === 'done'
      ? t.done
      : phase === 'error'
        ? t.error
        : phase === 'cancelled'
          ? t.cancelled
          : null;
  const summary =
    label === null
      ? null
      : [
          label,
          formatElapsed(elapsedMs),
          ...(steps.length > 0 ? [t.steps(steps.length)] : []),
        ].join(t.separator);

  const headline = headlineFrom(
    live.reasoningSummary?.trim() ? live.reasoningSummary : live.reasoning,
  );

  return {
    headline,
    phase,
    current,
    stepCount: steps.length,
    hiddenCount: Math.max(0, steps.length - visible),
    elapsedMs,
    steps,
    summary,
    needsAttention:
      live.tools.some((tool) => tool.status === 'error') ||
      (!settled && (live.approvals.length > 0 || live.status === 'waiting_approval')),
  };
}
