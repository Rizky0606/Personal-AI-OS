import { describe, expect, it } from 'vitest';
import { TeamRequestSchema } from './api-schemas.js';
import { TeamEventSchema } from './events.js';
import { ID_A, ID_B, TS } from './fixtures.js';

describe('team event contract', () => {
  it('accepts stable team/member status events without exposing prompt or filesystem paths', () => {
    expect(
      TeamEventSchema.parse({
        type: 'team.created',
        teamId: ID_A,
        status: 'queued',
        createdAt: TS,
      }),
    ).toEqual({
      type: 'team.created',
      teamId: ID_A,
      status: 'queued',
      createdAt: TS,
    });

    expect(
      TeamEventSchema.parse({
        type: 'team.member.updated',
        teamId: ID_A,
        member: { id: ID_B, role: 'worker', status: 'running', updatedAt: TS },
      }),
    ).toMatchObject({ type: 'team.member.updated', member: { id: ID_B, status: 'running' } });

    expect(
      TeamEventSchema.safeParse({
        type: 'team.member.updated',
        teamId: ID_A,
        member: { id: ID_B, role: 'worker', status: 'running', updatedAt: TS, worktreePath: 'C:/secret' },
      }).success,
    ).toBe(false);
  });
});

describe('team request contract', () => {
  it('defaults to conservative hard caps and rejects values above them', () => {
    const request = TeamRequestSchema.parse({ projectId: ID_A, prompt: 'Build feature' });
    expect(request.limits).toEqual({
      maxWorkers: 1,
      maxReviewRounds: 2,
      teamTimeoutMinutes: 120,
      memberTimeoutMinutes: 30,
      stepsPerMember: 100,
      tokensPerTeam: 100_000,
      tokensPerMember: 40_000,
      inputTokensPerCall: 20_000,
      outputTokensPerCall: 8_000,
    });
    expect(
      TeamRequestSchema.safeParse({
        projectId: ID_A,
        prompt: 'Build feature',
        limits: { maxWorkers: 2 },
      }).success,
    ).toBe(false);
  });
});
