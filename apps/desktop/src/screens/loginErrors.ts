import { ApiProblem, LoginInputError } from '../auth/authSession';
import { copy } from '../copy';

/** Pesan login untuk pengguna: apa yang gagal dan langkah berikutnya. */
export function loginErrorMessage(error: unknown, online: boolean): string {
  const e = copy.login.errors;
  if (error instanceof LoginInputError) {
    switch (error.reason) {
      case 'server_empty':
        return e.serverEmpty;
      case 'server_insecure':
        return e.serverInsecure;
      case 'server_invalid':
        return e.serverInvalid;
    }
  }
  if (error instanceof ApiProblem) {
    if (error.isNetwork) return online ? e.network : e.offline;
    if (error.status === 401) return e.invalidCredentials;
    if (error.status === 429) return e.rateLimited;
    if (error.status >= 500) return e.server;
  }
  return e.unknown;
}

/** Hanya digit, maksimal 6: tempel dari aplikasi autentikator yang berspasi tetap sah. */
export function sanitizeTotp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}
