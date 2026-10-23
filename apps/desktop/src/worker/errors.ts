import { copy } from '../copy';
import { WorkerCallError } from './localClient';

/** Pesan untuk pengguna: apa yang gagal dan langkah berikutnya. */
export function workerErrorMessage(error: unknown): string {
  if (error instanceof WorkerCallError) return copy.workerErrors[error.code];
  return copy.workerErrors.internal;
}
