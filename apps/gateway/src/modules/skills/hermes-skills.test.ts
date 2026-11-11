import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHermesSkillSource } from './hermes-skills.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Saat ${name}.\n---\nIsi ${name}.\n`;
async function folderWith(count: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'aios-hermes-many-'));
  dirs.push(root);
  for (let i = 0; i < count; i++) {
    const dir = join(root, `kategori-${i % 10}`, `skill-${i}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), skill(`skill-${i}`));
  }
  return root;
}
const failingApi = (() => Promise.resolve(new Response('', { status: 500 }))) as typeof fetch;

describe('folder skill Hermes besar', () => {
  it('folder dengan 450 skill (seperti mesin nyata) terdaftar utuh, tanpa catatan pemotongan', async () => {
    const root = await folderWith(450);
    const source = createHermesSkillSource({
      url: 'http://127.0.0.1:1',
      root,
      fetchImpl: failingApi,
    });
    const list = await source.list();
    expect(list.via).toBe('folder');
    expect(list.items).toHaveLength(450);
    expect(list.note ?? '').not.toContain('dipotong');
  });

  it('di atas batas pengaman daftar dipotong DAN pemotongan diberitahukan', async () => {
    const root = await folderWith(2010);
    const source = createHermesSkillSource({
      url: 'http://127.0.0.1:1',
      root,
      fetchImpl: failingApi,
    });
    const list = await source.list();
    expect(list.items).toHaveLength(2000);
    expect(list.note).toContain('dipotong');
  }, 60_000);
});
