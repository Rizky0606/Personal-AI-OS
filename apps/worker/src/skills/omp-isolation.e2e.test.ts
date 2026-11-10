import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOmpAdapter, stdioTransport, uuidv7 } from '@aios/adapters';
import type { AgentEvent } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockLlm, type ChatRequest } from '../testing/mock-llm.js';
import { resolveOmp } from '../runs/omp-path.js';

/**
 * Bukti isolasi skill dengan omp SUNGGUHAN (dilewati bila omp tidak terpasang): daftar skill di system prompt
 * yang diterima model hanya berisi katalog aplikasi. Skill umpan di HOME pengguna (~/.claude/skills,
 * ~/.omp/agent/skills) dan di repo kerja (.claude/skills) tidak boleh ikut (VERIFICATION.md mencatat bahwa
 * omp otomatis memuat skill provider lain).
 */
const ompPath = await resolveOmp().catch(() => null);

const frontmatter = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\nIsi ${name}.\n`;

describe.skipIf(ompPath === null)('isolasi skill omp (omp sungguhan)', () => {
  let base: string;
  let home: string;
  let repo: string;
  let llmServer: Server;
  let llmUrl: string;
  let requests: ChatRequest[];

  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-skill-iso-')));
    home = path.join(base, 'home');
    repo = path.join(base, 'repo');
    for (const dir of [
      path.join(home, '.claude', 'skills', 'umpan-claude'),
      path.join(home, '.omp', 'agent', 'skills', 'umpan-omp'),
      path.join(repo, '.claude', 'skills', 'umpan-repo'),
    ]) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'SKILL.md'),
        frontmatter(path.basename(dir), `UMPAN ${path.basename(dir)} jangan dimuat.`),
      );
    }
    const llm = mockLlm(() => ({ text: 'ok' }));
    requests = llm.requests;
    llmServer = createServer(llm.handler);
    await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
    llmUrl = `http://127.0.0.1:${(llmServer.address() as AddressInfo).port}/v1`;
  });
  afterEach(async () => {
    await new Promise((resolve) => llmServer.close(resolve));
    await fs.rm(base, { recursive: true, force: true });
  });

  async function runOnce(skills: { id: string; description: string; body: string }[]) {
    const runDir = path.join(base, 'run');
    await fs.mkdir(runDir, { recursive: true });
    const adapter = createOmpAdapter({
      llm: { baseUrl: llmUrl, apiKey: 'kunci-lokal' },
      launch: (spec) => {
        const child = spawn(ompPath!, spec.args, {
          cwd: spec.cwd,
          // HOME palsu = "mesin pengguna" yang berisi skill provider lain.
          env: { ...process.env, ...spec.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
        });
        return stdioTransport(child, () => child.kill('SIGKILL'));
      },
    });
    const handle = await adapter.startRun({
      runId: uuidv7(),
      messageId: uuidv7(),
      prompt: 'halo',
      systemPrompt: '# Peran: Uji',
      model: 'mock-1',
      cwd: repo,
      runDir,
      skillIds: skills.map((s) => s.id),
      skills: skills.map((s) => ({
        ...s,
        checksum: 'a'.repeat(64),
      })),
    });
    const events: AgentEvent[] = [];
    for await (const event of handle.events) events.push(event);
    return events;
  }

  /** Nama skill yang tampil di blok <skills> system prompt yang benar-benar diterima model. */
  const skillNamesInPrompt = (): string[] => {
    const system = requests[0]?.body.messages.find(
      (m) => m.role === 'system' || m.role === 'developer',
    );
    const content = system?.content;
    const textOf = (part: unknown): string => {
      if (typeof part === 'string') return part;
      const text = (part as { text?: unknown } | null)?.text;
      return typeof text === 'string' ? text : '';
    };
    const text = Array.isArray(content)
      ? (content as unknown[]).map(textOf).join('\n')
      : textOf(content);
    const block = /<skills>([\s\S]*?)<\/skills>/.exec(text)?.[1] ?? '';
    return [...block.matchAll(/^- ([^:\n]+):/gm)].map((m) => m[1]!.trim());
  };

  it('daftar skill di prompt HANYA katalog aplikasi (skill HOME, ~/.claude, ~/.omp, sistem, dan repo tidak ikut)', async () => {
    const events = await runOnce([
      { id: 'katalog-satu', description: 'Saat menguji katalog satu.', body: 'Isi satu.' },
    ]);

    expect(events.map((e) => e.type)).toContain('run.completed');
    expect(skillNamesInPrompt()).toEqual(['katalog-satu']);
  }, 90_000);

  it('tanpa skill katalog: tidak ada skill apa pun di prompt', async () => {
    await runOnce([]);
    expect(skillNamesInPrompt()).toEqual([]);
  }, 90_000);
});
