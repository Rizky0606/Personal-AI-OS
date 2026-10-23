import { apiErrorMessage } from '../api/errors';
import { ApiProblem } from '../auth/authSession';

/** Kode kesalahan kanban yang pesan servernya sudah menyebut penyebab dan langkah berikutnya. */
const SPECIFIC = new Set([
  'task_running',
  'task_not_runnable',
  'status_managed',
  'role_not_coding',
  'unknown_role',
  'breakdown_unparseable',
  'router_unavailable',
]);

/** Pesan untuk kartu: kode khusus memakai pesan server (Indonesia, spesifik); selebihnya pesan umum per status. */
export function taskErrorMessage(error: unknown, online: boolean): string {
  if (error instanceof ApiProblem && SPECIFIC.has(error.code) && error.message)
    return error.message;
  return apiErrorMessage(error, online);
}
