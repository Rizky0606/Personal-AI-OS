import type { Scope } from '@aios/contracts';
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { AppError } from '../../errors.js';
import type { AuthContext, AuthService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Diisi oleh authenticateHook; tidak ada pada route publik. */
    auth?: AuthContext;
  }
}

const bearer = (req: FastifyRequest): string | undefined =>
  /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];

/** Hook onRequest untuk semua route yang butuh login. */
export function authenticateHook(auth: AuthService): onRequestAsyncHookHandler {
  return async (req) => {
    const token = bearer(req);
    if (!token) {
      throw new AppError(
        401,
        'missing_token',
        'Header Authorization: Bearer <access_token> wajib ada.',
        undefined,
        { 'www-authenticate': 'Bearer' },
      );
    }
    req.auth = await auth.authenticate(token);
  };
}

/** Dipasang di route (setelah authenticateHook): menolak token yang tidak punya scope. */
export function requireScope(scope: Scope): onRequestAsyncHookHandler {
  return (req) => {
    if (!req.auth?.scopes.includes(scope)) {
      return Promise.reject(
        new AppError(403, 'insufficient_scope', `Token ini tidak punya scope "${scope}".`),
      );
    }
    return Promise.resolve();
  };
}

/** Konteks login dari request yang sudah melewati authenticateHook. */
export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) {
    throw new AppError(401, 'missing_token', 'Belum login.', undefined, {
      'www-authenticate': 'Bearer',
    });
  }
  return req.auth;
}
