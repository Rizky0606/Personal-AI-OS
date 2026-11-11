import { apiErrorMessage } from '../api/errors';
import { ApiProblem } from '../auth/authSession';

/** Galat skill membawa penjelasan spesifik dari gateway (pemindai, id bentrok, skill bawaan); selain itu pesan umum. */
export function skillErrorMessage(error: unknown, online: boolean): string {
  if (error instanceof ApiProblem && /^(skill_|hermes_)/.test(error.code) && error.message) {
    return error.message;
  }
  return apiErrorMessage(error, online);
}

/** Kode galat yang berarti pengguna harus menyetujui peringatan atau bahaya secara eksplisit. */
export const needsAcknowledge = (error: unknown): boolean =>
  error instanceof ApiProblem &&
  (error.code === 'skill_scan_confirm' || error.code === 'skill_scan_blocked');
