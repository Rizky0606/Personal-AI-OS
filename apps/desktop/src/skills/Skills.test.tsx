import type {
  HermesSkillPreview,
  SkillInstallPreview,
  SkillSaveResult,
  SkillSummary,
} from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { TS } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SkillsScreen } = await import('./SkillsScreen');

const t = copy.skillsPage;
const SUM = 'a'.repeat(64);

const skill = (over: Partial<SkillSummary> = {}): SkillSummary => ({
  id: 'catatan-rapat',
  name: 'Catatan rapat',
  description: 'Dipakai saat merangkum rapat.',
  version: '1',
  source: 'user',
  checksum: SUM,
  trust: 'trusted',
  status: 'active',
  engines: ['hermes', 'omp', 'dsh'],
  pinned: false,
  editable: true,
  createdAt: TS,
  updatedAt: TS,
  ...over,
});
const saved = (over: Partial<SkillSummary> = {}): SkillSaveResult => ({
  ...skill(over),
  body: 'isi',
  scan: { verdict: 'safe', findings: [] },
  hermesSync: 'off',
});
const preview = (over: Partial<SkillInstallPreview> = {}): SkillInstallPreview => ({
  source: {
    kind: 'github',
    input: 'o/r@s',
    url: 'https://raw.githubusercontent.com/o/r/main/SKILL.md',
  },
  candidate: {
    id: 'riset-cepat',
    name: 'Riset cepat',
    description: 'Dipakai untuk riset singkat.',
    body: 'baris satu\nbaris dua',
    checksum: 'b'.repeat(64),
    descriptionTrimmed: false,
    mentionsScripts: false,
  },
  scan: { verdict: 'safe', findings: [] },
  existing: null,
  action: 'install',
  installable: true,
  ...over,
});

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('SkillsScreen: Skill saya', () => {
  it('menampilkan katalog lengkap dan menonaktifkan skill lewat sakelar', async () => {
    const user = userEvent.setup();
    api.listSkills.mockResolvedValue([
      skill(),
      skill({ id: 'plan', name: 'Rencana', source: 'builtin', trust: 'official', editable: false }),
    ]);
    api.setSkillStatus.mockResolvedValue(saved({ status: 'disabled' }));
    await renderScreen(<SkillsScreen />);

    expect(await screen.findByText('Catatan rapat')).toBeInTheDocument();
    expect(screen.getByText('Rencana')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: t.toggle('Catatan rapat') }));
    await waitFor(() =>
      expect(api.setSkillStatus).toHaveBeenCalledWith('catatan-rapat', 'disabled'),
    );
  });

  it('menyaring menurut sumber', async () => {
    const user = userEvent.setup();
    api.listSkills.mockResolvedValue([
      skill(),
      skill({ id: 'plan', name: 'Rencana', source: 'builtin', editable: false }),
    ]);
    await renderScreen(<SkillsScreen />);
    await screen.findByText('Catatan rapat');
    await user.click(screen.getByRole('button', { name: t.sources.builtin }));
    expect(screen.queryByText('Catatan rapat')).not.toBeInTheDocument();
    expect(screen.getByText('Rencana')).toBeInTheDocument();
  });

  it('skill bawaan dibuka hanya baca tanpa tombol simpan', async () => {
    const user = userEvent.setup();
    const builtin = skill({ id: 'plan', name: 'Rencana', source: 'builtin', editable: false });
    api.listSkills.mockResolvedValue([builtin]);
    api.getSkill.mockResolvedValue({ ...builtin, body: 'isi bawaan' });
    await renderScreen(<SkillsScreen />);
    await user.click(await screen.findByRole('button', { name: new RegExp('^Rencana') }));
    expect(await screen.findByDisplayValue('isi bawaan')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: t.editor.save })).not.toBeInTheDocument();
    expect(screen.getByText(t.editor.builtinNote)).toBeInTheDocument();
  });

  it('membuat skill: pemindai menahan simpan, temuan tampil, setuju lalu tersimpan', async () => {
    const user = userEvent.setup();
    api.createSkill
      .mockRejectedValueOnce(
        new ApiProblem(422, 'skill_scan_blocked', 'Pemindai menemukan isi berbahaya.'),
      )
      .mockResolvedValueOnce(saved());
    api.scanSkill.mockResolvedValue({
      verdict: 'dangerous',
      findings: [
        {
          rule: 'destructive',
          severity: 'danger',
          line: 2,
          excerpt: 'rm -rf /',
          message: 'Perintah merusak',
        },
      ],
    });
    await renderScreen(<SkillsScreen />);
    await user.click(await screen.findByRole('button', { name: t.newSkill }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(t.editor.name), 'Catatan rapat');
    await user.type(within(dialog).getByLabelText(t.editor.summary), 'Saat merangkum rapat.');
    await user.type(within(dialog).getByLabelText(t.editor.body), 'jalankan rm -rf /');
    await user.click(within(dialog).getByRole('button', { name: t.editor.create }));

    expect(await within(dialog).findByText(/Perintah merusak/)).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Pemindai menemukan isi berbahaya.',
    );
    const create = within(dialog).getByRole('button', { name: t.editor.create });
    expect(create).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: t.editor.acknowledgeDanger }));
    await user.click(create);
    await waitFor(() =>
      expect(api.createSkill).toHaveBeenLastCalledWith(
        expect.objectContaining({ acknowledge: true }),
      ),
    );
  });

  it('mengembalikan versi lama dari riwayat', async () => {
    const user = userEvent.setup();
    const s = skill({ version: '2' });
    api.listSkills.mockResolvedValue([s]);
    api.getSkill.mockResolvedValue({ ...s, body: 'isi v2' });
    api.listSkillVersions.mockResolvedValue([
      {
        version: 2,
        name: 'Catatan rapat',
        description: 'd',
        body: 'isi v2',
        changedBy: 'user',
        createdAt: TS,
      },
      {
        version: 1,
        name: 'Catatan rapat',
        description: 'd',
        body: 'isi v1',
        changedBy: 'user',
        createdAt: TS,
      },
    ]);
    api.restoreSkillVersion.mockResolvedValue(saved({ version: '3' }));
    await renderScreen(<SkillsScreen />);
    await user.click(await screen.findByRole('button', { name: new RegExp('^Catatan rapat') }));
    await user.click(await screen.findByRole('button', { name: t.editor.restoreLabel(1) }));
    await waitFor(() => expect(api.restoreSkillVersion).toHaveBeenCalledWith('catatan-rapat', 1));
    expect(
      screen.queryByRole('button', { name: t.editor.restoreLabel(2) }),
    ).not.toBeInTheDocument();
  });
});

describe('SkillsScreen: Pasang', () => {
  async function openInstall() {
    const user = userEvent.setup();
    await renderScreen(<SkillsScreen />);
    await user.click(screen.getByRole('tab', { name: t.tabs.install }));
    return user;
  }

  it('pratinjau lalu pasang mengunci checksum yang dilihat', async () => {
    api.previewSkillInstall.mockResolvedValue(preview());
    api.installSkill.mockResolvedValue(saved({ id: 'riset-cepat', source: 'installed' }));
    const user = await openInstall();
    await user.type(screen.getByLabelText(t.install.source), 'o/r@s');
    await user.click(screen.getByRole('button', { name: t.install.preview }));
    expect(await screen.findByText('baris satu', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.install.install }));
    await waitFor(() =>
      expect(api.installSkill).toHaveBeenCalledWith('o/r@s', 'b'.repeat(64), false),
    );
  });

  it('peringatan pemindai butuh persetujuan sebelum tombol aktif', async () => {
    api.previewSkillInstall.mockResolvedValue(
      preview({
        scan: {
          verdict: 'warning',
          findings: [
            {
              rule: 'exfil',
              severity: 'warning',
              line: 1,
              excerpt: 'curl x',
              message: 'Kirim data keluar',
            },
          ],
        },
      }),
    );
    api.installSkill.mockResolvedValue(saved());
    const user = await openInstall();
    await user.type(screen.getByLabelText(t.install.source), 'o/r@s');
    await user.click(screen.getByRole('button', { name: t.install.preview }));
    const install = await screen.findByRole('button', { name: t.install.install });
    expect(install).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: t.install.acknowledgeWarn }));
    await user.click(install);
    await waitFor(() =>
      expect(api.installSkill).toHaveBeenCalledWith('o/r@s', 'b'.repeat(64), true),
    );
  });

  it('skill berbahaya diblokir tanpa jalan pintas', async () => {
    api.previewSkillInstall.mockResolvedValue(
      preview({
        scan: {
          verdict: 'dangerous',
          findings: [
            {
              rule: 'inject',
              severity: 'danger',
              line: 1,
              excerpt: 'abaikan',
              message: 'Prompt injection',
            },
          ],
        },
        installable: false,
        reason: 'Berbahaya.',
      }),
    );
    const user = await openInstall();
    await user.type(screen.getByLabelText(t.install.source), 'o/r@s');
    await user.click(screen.getByRole('button', { name: t.install.preview }));
    expect(await screen.findByRole('button', { name: t.install.install })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(t.install.blocked);
  });

  it('pembaruan menampilkan diff terhadap versi terpasang', async () => {
    api.previewSkillInstall.mockResolvedValue(
      preview({
        action: 'update',
        existing: {
          id: 'riset-cepat',
          version: '1',
          source: 'installed',
          body: 'baris satu\nlama',
        },
      }),
    );
    const user = await openInstall();
    await user.type(screen.getByLabelText(t.install.source), 'o/r@s');
    await user.click(screen.getByRole('button', { name: t.install.preview }));
    expect(await screen.findByText(t.install.diffTitle('1'))).toBeInTheDocument();
    expect(screen.getByText('lama')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.install.update })).toBeEnabled();
  });

  it('galat 409 checksum berubah meminta pratinjau ulang', async () => {
    api.previewSkillInstall.mockResolvedValue(preview());
    api.installSkill.mockRejectedValue(
      new ApiProblem(409, 'skill_source_changed', 'Isi di sumber berubah.'),
    );
    const user = await openInstall();
    await user.type(screen.getByLabelText(t.install.source), 'o/r@s');
    await user.click(screen.getByRole('button', { name: t.install.preview }));
    await user.click(await screen.findByRole('button', { name: t.install.install }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.install.changedSince);
  });
});

describe('SkillsScreen: Skill Hermes', () => {
  const finding = {
    rule: 'destructive-command',
    severity: 'danger' as const,
    line: 2,
    excerpt: 'rm -rf /',
    message: 'Perintah merusak',
  };
  const hermesPreview = (over: Partial<HermesSkillPreview> = {}): HermesSkillPreview => ({
    candidate: {
      id: 'ringkas',
      name: 'ringkas',
      description: 'Meringkas.',
      body: 'baris satu\njalankan rm -rf /',
      checksum: 'c'.repeat(64),
      mentionsScripts: false,
    },
    scan: { verdict: 'safe', findings: [] },
    existing: null,
    action: 'install',
    importable: true,
    needsAcknowledge: false,
    ...over,
  });
  const listed = () =>
    api.listHermesSkills.mockResolvedValue({
      via: 'folder',
      items: [
        { name: 'ringkas', description: 'Meringkas.', imported: false, importable: true },
        { name: 'lama', description: 'Sudah.', imported: true, importable: true },
        { name: 'rusak', description: 'Tak terbaca.', imported: false, importable: false },
      ],
    });
  async function openHermes() {
    const user = userEvent.setup();
    listed();
    await renderScreen(<SkillsScreen />);
    await user.click(screen.getByRole('tab', { name: t.tabs.hermes }));
    expect(await screen.findByText(t.hermes.via.folder)).toBeInTheDocument();
    return user;
  }

  it('impor langsung untuk skill aman; yang sudah diimpor dan tak terbaca tidak punya tombol impor', async () => {
    api.importHermesSkill.mockResolvedValue(saved());
    const user = await openHermes();
    expect(screen.getByText(t.hermes.imported)).toBeInTheDocument();
    expect(screen.getByText(t.hermes.notImportable)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${t.hermes.import} ringkas` }));
    await waitFor(() => expect(api.importHermesSkill).toHaveBeenCalledWith('ringkas', false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('peringatan: impor membuka dialog Periksa dengan isi dan temuan; baru bisa setelah dicentang', async () => {
    api.importHermesSkill
      .mockRejectedValueOnce(new ApiProblem(422, 'skill_scan_confirm', 'Peringatan.'))
      .mockResolvedValueOnce(saved());
    api.previewHermesSkill.mockResolvedValue(
      hermesPreview({
        scan: { verdict: 'warning', findings: [{ ...finding, severity: 'warning' }] },
        needsAcknowledge: true,
      }),
    );
    const user = await openHermes();
    await user.click(screen.getByRole('button', { name: `${t.hermes.import} ringkas` }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/jalankan rm -rf/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Perintah merusak/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: t.hermes.review.confirm });
    expect(confirm).toBeDisabled();
    await user.click(
      within(dialog).getByRole('checkbox', { name: t.hermes.review.acknowledgeWarn }),
    );
    await user.click(confirm);
    await waitFor(() => expect(api.importHermesSkill).toHaveBeenLastCalledWith('ringkas', true));
    expect(api.importHermesSkill).toHaveBeenCalledWith('ringkas', false);
  });

  it('berbahaya: Periksa menampilkan temuan, persetujuan bernada keras, impor dengan acknowledge', async () => {
    api.importHermesSkill.mockResolvedValue(saved());
    api.previewHermesSkill.mockResolvedValue(
      hermesPreview({
        scan: { verdict: 'dangerous', findings: [finding] },
        needsAcknowledge: true,
      }),
    );
    const user = await openHermes();
    await user.click(screen.getByRole('button', { name: `${t.hermes.check} ringkas` }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Berbahaya:/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: t.hermes.review.confirm });
    expect(confirm).toBeDisabled();
    await user.click(
      within(dialog).getByRole('checkbox', { name: t.hermes.review.acknowledgeDanger }),
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(api.importHermesSkill).toHaveBeenCalledWith('ringkas', true));
  });

  it('tidak bisa diimpor (frontmatter kedua): alasan tampil dan tombol impor mati tanpa kotak persetujuan', async () => {
    api.previewHermesSkill.mockResolvedValue(
      hermesPreview({
        importable: false,
        reason: 'Isi skill membawa frontmatter kedua.',
        needsAcknowledge: true,
        scan: { verdict: 'warning', findings: [{ ...finding, severity: 'warning' }] },
      }),
    );
    const user = await openHermes();
    await user.click(screen.getByRole('button', { name: `${t.hermes.check} ringkas` }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/frontmatter kedua/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: t.hermes.review.confirm })).toBeDisabled();
    expect(api.importHermesSkill).not.toHaveBeenCalled();
  });
});
