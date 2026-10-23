import { describe, expect, it } from 'vitest';
import { ApiProblem, LoginInputError } from '../auth/authSession';
import { copy } from '../copy';
import { loginErrorMessage, sanitizeTotp } from './loginErrors';

describe('loginErrorMessage', () => {
  const e = copy.login.errors;

  it('kesalahan input alamat', () => {
    expect(loginErrorMessage(new LoginInputError('server_empty'), true)).toBe(e.serverEmpty);
    expect(loginErrorMessage(new LoginInputError('server_invalid'), true)).toBe(e.serverInvalid);
    expect(loginErrorMessage(new LoginInputError('server_insecure'), true)).toBe(e.serverInsecure);
  });

  it('kredensial, rate limit, server, dan jaringan', () => {
    expect(loginErrorMessage(new ApiProblem(401, 'invalid_credentials', ''), true)).toBe(
      e.invalidCredentials,
    );
    expect(loginErrorMessage(new ApiProblem(429, 'rate_limited', ''), true)).toBe(e.rateLimited);
    expect(loginErrorMessage(new ApiProblem(503, 'x', ''), true)).toBe(e.server);
    expect(loginErrorMessage(new ApiProblem(0, 'network', ''), true)).toBe(e.network);
    expect(loginErrorMessage(new ApiProblem(0, 'network', ''), false)).toBe(e.offline);
    expect(loginErrorMessage(new Error('?'), true)).toBe(e.unknown);
  });
});

describe('sanitizeTotp', () => {
  it('hanya digit dan maksimal 6', () => {
    expect(sanitizeTotp('12 34-5678')).toBe('123456');
    expect(sanitizeTotp('abc')).toBe('');
  });
});
