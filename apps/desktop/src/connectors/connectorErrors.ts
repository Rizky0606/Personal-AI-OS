import { apiErrorMessage } from '../api/errors';
import { ApiProblem } from '../auth/authSession';

/**
 * Galat konektor membawa penjelasan spesifik dari gateway (nama terpakai, URL tidak sah, server tidak
 * terjangkau); selain itu dipakai pesan umum.
 */
export function connectorErrorMessage(error: unknown, online: boolean): string {
  if (error instanceof ApiProblem && error.code.startsWith('connector_') && error.message) {
    return error.message;
  }
  return apiErrorMessage(error, online);
}
