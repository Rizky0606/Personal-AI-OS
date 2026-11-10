import {
  ConversationProgressSchema,
  ConversationSchema,
  RunEventsResponseSchema,
  RunSchema,
  SendMessageResponseSchema,
  type AgentEvent,
} from '@aios/contracts';
import { loadRegistry } from '@aios/roles';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';

const registry = loadRegistry();
type ContextUsed = Extract<AgentEvent, { type: 'context.used' }>;

interface Harness {
  env: AuthEnv;
  hermes: FakeHermes;
  token: string;
  run(message: string, extra?: object): Promise<{ runId: string; conversationId: string }>;
  contextUsed(runId: string): Promise<ContextUsed[]>;
  progress(conversationId: string): Promise<ReturnType<typeof ConversationProgressSchema.parse>>;
}

async function harness(options: Parameters<typeof createAuthEnv>[1] = {}): Promise<Harness> {
  const hermes = await startFakeHermes();
  const env = await createAuthEnv(inject('testDatabaseUrl'), { ...options, hermesUrl: hermes.url });
  const token = (await env.loginOk({ kind: 'desktop' })).accessToken;
  return {
    env,
    hermes,
    token,
    async run(message, extra = {}) {
      const conv = ConversationSchema.parse(
        (await env.post('/conversations', { surface: 'windows' }, token)).json(),
      );
      const res = await env.post(
        `/conversations/${conv.id}/messages`,
        { parts: [{ type: 'text', text: message }], ...extra },
        token,
      );
      expect(res.statusCode, res.body).toBe(201);
      const sent = SendMessageResponseSchema.parse(res.json());
      const deadline = Date.now() + 30_000;
      for (;;) {
        const run = RunSchema.parse((await env.get(`/runs/${sent.run.id}`, token)).json());
        if (['completed', 'failed', 'cancelled'].includes(run.status) || Date.now() > deadline)
          break;
        await new Promise((r) => setTimeout(r, 20));
      }
      return { runId: sent.run.id, conversationId: conv.id };
    },
    async contextUsed(runId) {
      const items = RunEventsResponseSchema.parse(
        (await env.get(`/runs/${runId}/events`, token)).json(),
      ).items;
      return items
        .filter((e) => e.event.type === 'context.used')
        .map((e) => e.event as ContextUsed);
    },
    async progress(conversationId) {
      const res = await env.get(`/conversations/${conversationId}/progress`, token);
      expect(res.statusCode, res.body).toBe(200);
      return ConversationProgressSchema.parse(res.json());
    },
  };
}

const close = async (h: Harness) => {
  await h.env.close();
  await h.hermes.close();
};

describe('skill dibuka agent: context.used.openedSkills (Hermes)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => close(h));
  beforeEach(() => {
    h.hermes.requests.length = 0;
  });

  const opens =
    (label: string, id = `call_${label}`) =>
    (s: Parameters<Parameters<FakeHermes['onRequest']>[0]>[0]) => {
      s.toolProgress({ tool: 'skill_view', label, toolCallId: id, status: 'running' });
      s.toolProgress({ tool: 'skill_view', toolCallId: id, status: 'completed' });
    };

  it('skill aios-<id> yang dibuka lewat skill_view dilaporkan di openedSkills, terpisah dari pinnedSkills', async () => {
    h.hermes.onRequest((s) => {
      opens('aios-citation')(s);
      s.delta('selesai');
      s.finish();
      s.done();
    });
    const { runId, conversationId } = await h.run('Riset tren terbaru, sertakan sumber.');

    const events = await h.contextUsed(runId);
    expect(events.length).toBe(2); // awal (opened kosong) lalu pembaruan saat skill dibuka
    expect(events[0]!.openedSkills).toEqual([]);
    expect(events[1]!.openedSkills).toEqual(['citation']);
    // Skill yang dimuat ke prompt tidak berubah artinya: skills == pinnedSkills (inti + milik agent).
    expect(events[1]!.skills).toEqual(events[1]!.pinnedSkills);
    expect(events[1]!.pinnedSkills).not.toContain('citation');
    // Memori/model tidak tertimpa oleh pembaruan.
    expect(events[1]!.engine).toBe('hermes');

    const used = (await h.progress(conversationId)).used;
    expect(used.openedSkills).toEqual(['citation']);
    expect(used.skills).toEqual(events[1]!.skills);
    expect(used.pinnedSkills).toEqual(events[1]!.pinnedSkills);
  });

  it('skill bawaan Hermes (bukan aios-) dan tool lain tidak dihitung sebagai skill katalog dibuka', async () => {
    h.hermes.onRequest((s) => {
      opens('notion')(s);
      s.toolProgress({ tool: 'terminal', label: 'echo hai', toolCallId: 'c9', status: 'running' });
      s.toolProgress({ tool: 'terminal', toolCallId: 'c9', status: 'completed' });
      s.delta('oke');
      s.finish();
      s.done();
    });
    const { runId } = await h.run('Halo');
    const events = await h.contextUsed(runId);
    expect(events).toHaveLength(1);
    expect(events[0]!.openedSkills).toEqual([]);
  });

  it('skill yang sama dibuka dua kali hanya dilaporkan sekali', async () => {
    h.hermes.onRequest((s) => {
      opens('aios-citation', 'a1')(s);
      opens('aios-citation', 'a2')(s);
      opens('aios-stop-slop', 'a3')(s);
      s.delta('x');
      s.finish();
      s.done();
    });
    const { runId } = await h.run('Tulis artikel tanpa klise.');
    const events = await h.contextUsed(runId);
    expect(events.map((e) => e.openedSkills)).toEqual([
      [],
      ['citation'],
      ['citation', 'stop-slop'],
    ]);
  });
});

describe('paket kata kunci: indeks (bawaan) vs fallback per mesin', () => {
  const message = 'Riset tren terbaru, bandingkan sumber dan sertakan referensi.';
  const citationBody = registry.skills.get('citation')!.body;
  const systemOf = (h: Harness) => h.hermes.requests[0]!.body.messages[0]!.content;

  it('bawaan: skill khusus hanya muncul sebagai indeks, isinya TIDAK ditempel', async () => {
    const h = await harness();
    try {
      h.hermes.onRequest((s) => (s.delta('ok'), s.finish(), s.done()));
      const { runId } = await h.run(message);
      const system = systemOf(h);
      expect(system).toContain('# Skill tersedia');
      // Nama di indeks = nama yang bisa dibuka Hermes (skill hasil sinkron bernama aios-<id>).
      expect(system).toContain(`- aios-citation: ${registry.skills.get('citation')!.description}`);
      expect(system).not.toContain('\n- citation:');
      expect(system).not.toContain(citationBody);
      const [first] = await h.contextUsed(runId);
      expect(first!.skills).not.toContain('citation');
    } finally {
      await close(h);
    }
  });

  it('fallback SKILL_PACKS_EAGER_ENGINES=hermes: isi paket ditempel utuh seperti sebelum P9', async () => {
    const h = await harness({ eagerSkillEngines: new Set(['hermes']) });
    try {
      h.hermes.onRequest((s) => (s.delta('ok'), s.finish(), s.done()));
      const { runId } = await h.run(message);
      const system = systemOf(h);
      expect(system).toContain(citationBody);
      expect(system).not.toContain('# Skill tersedia');
      const [first] = await h.contextUsed(runId);
      expect(first!.skills).toContain('citation');
    } finally {
      await close(h);
    }
  });

  it('pilihan manual composer (skills[]) tetap ditempel utuh walau mode bawaan', async () => {
    const h = await harness();
    try {
      h.hermes.onRequest((s) => (s.delta('ok'), s.finish(), s.done()));
      await h.run(message, { skills: ['citation'] });
      const system = systemOf(h);
      expect(system).toContain(citationBody);
      expect(system).not.toContain('- aios-citation:');
    } finally {
      await close(h);
    }
  });

  it('skill inti selalu ditempel utuh, termasuk di mode bawaan', async () => {
    const h = await harness();
    try {
      h.hermes.onRequest((s) => (s.delta('ok'), s.finish(), s.done()));
      await h.run('Halo');
      expect(systemOf(h)).toContain(registry.skills.get('scope-guard')!.body);
    } finally {
      await close(h);
    }
  });
});
