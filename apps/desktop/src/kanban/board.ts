import type { Task, TaskStatus } from '@aios/contracts';

/** Urutan kolom di papan. */
export const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'running', 'review', 'done'];

/** Kolom yang boleh dituju pengguna; Running dan Review hanya diisi sistem saat kartu dikerjakan. */
export const USER_COLUMNS: TaskStatus[] = ['backlog', 'todo', 'done'];

export type Board = Record<TaskStatus, Task[]>;

/** Kartu menunggu slot run: ada di Running tetapi belum punya run. */
export const isQueued = (task: Task): boolean => task.status === 'running' && task.runId === null;

/** Kartu sedang dikerjakan agent: tidak boleh dipindah sampai run selesai atau dihentikan. */
export const isLocked = (task: Task): boolean => task.status === 'running' && task.runId !== null;

/** Bisa dikerjakan dengan AI: hanya dari Backlog atau Todo. */
export const isRunnable = (task: Task): boolean =>
  task.status === 'backlog' || task.status === 'todo';

/** Judul, deskripsi, dan role hanya boleh diubah saat tidak ada pekerjaan agent yang bergantung padanya. */
export const isEditable = (task: Task): boolean => USER_COLUMNS.includes(task.status);

export function groupTasks(tasks: readonly Task[]): Board {
  const board: Board = { backlog: [], todo: [], running: [], review: [], done: [] };
  for (const task of tasks) board[task.status].push(task);
  for (const column of COLUMNS) {
    board[column].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }
  return board;
}

/** Memasang kartu dari event `task.updated` ke daftar yang sudah ada (ganti bila ada, tambah bila baru). */
export function upsertTask(tasks: readonly Task[], task: Task): Task[] {
  const exists = tasks.some((t) => t.id === task.id);
  return exists ? tasks.map((t) => (t.id === task.id ? task : t)) : [...tasks, task];
}

export function canDrop(task: Task, target: TaskStatus): boolean {
  return !isLocked(task) && USER_COLUMNS.includes(target);
}

export interface Placement {
  status: TaskStatus;
  /** Indeks di kolom tujuan, dihitung tanpa kartu yang dipindah (sama dengan aturan server). */
  position: number;
}

/** Tempat jatuh saat kartu dilepas di atas kartu lain (`overId`) atau di ruang kosong kolom (paling bawah). */
export function dropPlacement(
  board: Board,
  taskId: string,
  target: TaskStatus,
  overId?: string,
): Placement {
  const others = board[target].filter((t) => t.id !== taskId);
  const at = overId ? others.findIndex((t) => t.id === overId) : -1;
  return { status: target, position: at === -1 ? others.length : at };
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Alternatif keyboard untuk seret: naik/turun menukar urutan dalam kolom, kiri/kanan pindah ke kolom
 * pengguna tetangga (melewati Running dan Review). Null bila tidak ada tempat tujuan.
 */
export function stepPlacement(board: Board, task: Task, direction: Direction): Placement | null {
  if (isLocked(task)) return null;
  const column = board[task.status];
  const index = column.findIndex((t) => t.id === task.id);
  if (direction === 'up') return index > 0 ? { status: task.status, position: index - 1 } : null;
  if (direction === 'down') {
    return index !== -1 && index < column.length - 1
      ? { status: task.status, position: index + 1 }
      : null;
  }
  // Kolom tujuan untuk kiri/kanan: tetangga di urutan penuh yang boleh dituju.
  const step = direction === 'left' ? -1 : 1;
  let at = COLUMNS.indexOf(task.status) + step;
  while (at >= 0 && at < COLUMNS.length && !USER_COLUMNS.includes(COLUMNS[at]!)) at += step;
  const target = COLUMNS[at];
  return target ? dropPlacement(board, task.id, target) : null;
}

/** "+12 −3" untuk kartu; null bila tidak ada perubahan yang dicatat. */
export function formatDiffStat(stat: Task['diffStat']): string | null {
  if (!stat || (stat.additions === 0 && stat.deletions === 0)) return null;
  return `+${stat.additions} −${stat.deletions}`;
}

/** Warna titik/penanda status per kolom (token). Teks status tetap dibacakan; warna bukan satu-satunya penanda. */
export const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: 'bg-text-3',
  todo: 'bg-info',
  running: 'bg-accent',
  review: 'bg-warning',
  done: 'bg-success',
};
