import { describe, expect, it } from 'vitest';
import { GENERAL_AGENT, PROJECT_AGENT, pickAgent, selectSkills } from './agents.js';
import { loadRegistry } from './registry.js';

const known = new Set(loadRegistry().skills.keys());
const pick = (
  text: string,
  agent = PROJECT_AGENT,
  extra: Parameters<typeof selectSkills>[1] = { agent },
) => selectSkills(text, { known, ...extra, agent });

describe('pickAgent', () => {
  it('chat per folder project di Windows memakai agent project', () => {
    expect(pickAgent({ surface: 'windows', hasProject: true })).toBe(PROJECT_AGENT);
  });

  it('tanpa project, atau di Android, memakai agent umum', () => {
    expect(pickAgent({ surface: 'windows', hasProject: false })).toBe(GENERAL_AGENT);
    expect(pickAgent({ surface: 'android', hasProject: false })).toBe(GENERAL_AGENT);
    expect(pickAgent({ surface: 'android', hasProject: true })).toBe(GENERAL_AGENT);
  });
});

describe('selectSkills', () => {
  it.each([
    ['ubah tombol checkout jadi nonaktif saat loading', 'frontend', 'ui-baseline'],
    ['tambah endpoint /orders dan migrasi tabelnya', 'backend', 'api-design'],
    ['kenapa muncul error undefined di halaman profil', 'debugging', 'diagnosing-bugs'],
    ['review diff sebelum aku merge, cek keamanannya', 'review', 'security-basics'],
    ['riset bandingkan tiga library dan sebut sumbernya', 'research', 'citation'],
    ['tulis naskah video 60 detik dan caption', 'writing', 'script-structure'],
  ])('%s memuat paket %s', (text, packId, skill) => {
    const { packs, skills } = pick(text);
    expect(packs).toContain(packId);
    expect(skills).toContain(skill);
  });

  it('pesan biasa tidak memuat skill spesialis', () => {
    expect(pick('halo, apa kabar?')).toEqual({ packs: [], skills: [] });
  });

  it('beberapa paket bisa cocok sekaligus, skill tidak dobel', () => {
    const { packs, skills } = pick('perbaiki error di komponen tombol dan review aksesibilitasnya');
    expect(packs).toEqual(expect.arrayContaining(['debugging', 'frontend', 'review']));
    expect(new Set(skills).size).toBe(skills.length);
  });

  it('paket coding tampilan dan server hanya untuk agent project', () => {
    const text = 'buat komponen tombol dan endpoint baru';
    expect(pick(text, PROJECT_AGENT).packs).toEqual(
      expect.arrayContaining(['frontend', 'backend']),
    );
    expect(pick(text, GENERAL_AGENT).packs).not.toEqual(expect.arrayContaining(['frontend']));
    expect(pick(text, GENERAL_AGENT).packs).not.toEqual(expect.arrayContaining(['backend']));
  });

  it('pilihan pengguna menambah, pencabutan mengalahkan kata kunci, skill tak dikenal dibuang', () => {
    const { skills } = pick('ubah tombol checkout', PROJECT_AGENT, {
      agent: PROJECT_AGENT,
      extra: ['code-review', 'skill-hantu'],
      exclude: ['a11y-check'],
    });
    expect(skills).toContain('code-review');
    expect(skills).not.toContain('a11y-check');
    expect(skills).not.toContain('skill-hantu');
    expect(skills).toContain('ui-baseline');
  });
});
