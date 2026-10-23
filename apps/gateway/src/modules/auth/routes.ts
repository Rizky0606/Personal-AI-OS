import {
  LoginRequestSchema,
  LoginResponseSchema,
  RefreshRequestSchema,
  TokenPairSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireAuth } from './guard.js';
import type { AuthService } from './service.js';

export interface AuthRouteOptions {
  auth: AuthService;
  /** Batas per menit per alamat IP. */
  limits: { login: number; refresh: number };
}

/** Route publik: login dan refresh. Logout ada di sessionRoutes karena butuh access token. */
export const authRoutes: FastifyPluginCallback<AuthRouteOptions> = (app, opts, done) => {
  const perIp = (max: number) => ({
    rateLimit: { max, timeWindow: '1 minute', keyGenerator: (req: { ip: string }) => req.ip },
  });

  app.post('/auth/login', { config: perIp(opts.limits.login) }, async (req) => {
    const body = LoginRequestSchema.parse(req.body);
    return LoginResponseSchema.parse(await opts.auth.login(body, { ip: req.ip }));
  });

  app.post('/auth/refresh', { config: perIp(opts.limits.refresh) }, async (req) => {
    const { refreshToken } = RefreshRequestSchema.parse(req.body);
    return TokenPairSchema.parse(await opts.auth.refresh(refreshToken, { ip: req.ip }));
  });

  done();
};

/** Route yang butuh login (dipasang di scope terproteksi). */
export const sessionRoutes: FastifyPluginCallback<{ auth: AuthService }> = (app, opts, done) => {
  app.post('/auth/logout', async (req, reply) => {
    await opts.auth.logout(requireAuth(req).deviceId);
    return reply.code(204).send();
  });

  done();
};
