import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { ResponseShapeError } from './gateway';

/** Pesan untuk pengguna: apa yang gagal dan langkah berikutnya, tanpa menyalahkan. */
export function apiErrorMessage(error: unknown, online: boolean): string {
  if (error instanceof ResponseShapeError) return copy.errors.shape;
  if (!(error instanceof ApiProblem)) return online ? copy.errors.unknown : copy.errors.offline;
  if (error.isNetwork) return online ? copy.errors.network : copy.errors.offline;
  switch (error.status) {
    case 401:
      return copy.errors.session;
    case 404:
      return copy.errors.notFound;
    case 409:
      return copy.errors.conflict;
    case 422:
      return copy.errors.unprocessable;
    case 429:
      return copy.errors.rateLimited;
    default:
      return error.status >= 500 ? copy.errors.server : copy.errors.unknown;
  }
}
