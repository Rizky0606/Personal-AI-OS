import type { ProgressOutput, SkillProposal } from '@aios/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputCards, outputKey, outputTitle } from '../progress/OutputCards';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { TS } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { stripSkillProposal } from './skillProposal';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SkillProposalCards } = await import('./SkillProposalCards');
const t = copy.chat.skillProposal;
const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e10';
const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e11';
const MSG = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e12';
const OTHER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e13';
const P1 = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e01';

const proposal = (over: Partial<SkillProposal> = {}): SkillProposal => ({
  id: P1,
  kind: 'new',
  origin: 'agent',
  targetId: null,
  hermesName: null,
  name: 'Rapikan changelog',
  description: 'Saat merapikan changelog.',
  reason: 'Berulang.',
  status: 'pending',
  scan: { verdict: 'safe', findings: [] },
  conversationId: CONV,
  runId: RUN,
  messageId: MSG,
  createdAt: TS,
  decidedAt: null,
  decisionNote: null,
  resultSkillId: null,
  ...over,
});

beforeEach(() => {
  resetApi();
  useUiStore.setState({ skillsFocus: null });
});

describe('kartu usulan di bawah jawaban', () => {
  it('menampilkan "Agent mengusulkan skill: <nama>" dengan status; Tinjau membuka halaman Skill di usulan itu', async () => {
    api.listSkillProposals.mockResolvedValue([proposal()]);
    const { router } = await renderScreen(
      <SkillProposalCards conversationId={CONV} messageId={MSG} />,
    );
    expect(await screen.findByText(t.cardNew('Rapikan changelog'))).toBeInTheDocument();
    expect(screen.getByText(t.status.pending)).toBeInTheDocument();
    expect(api.listSkillProposals).toHaveBeenCalledWith({ status: 'all', conversationId: CONV });

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: t.reviewLabel('Rapikan changelog') }));
    expect(useUiStore.getState().skillsFocus).toEqual({ proposalId: P1 });
    expect(router.state.location.pathname).toBe('/skills');
  });

  it('usulan patch memakai kalimat perubahan; kartu tidak punya aksi yang mengaktifkan skill', async () => {
    api.listSkillProposals.mockResolvedValue([
      proposal({ kind: 'patch', targetId: 'catatan', name: 'Catatan rapat', status: 'approved' }),
    ]);
    await renderScreen(<SkillProposalCards conversationId={CONV} messageId={MSG} />);
    expect(await screen.findByText(t.cardPatch('Catatan rapat'))).toBeInTheDocument();
    expect(screen.getByText(t.status.approved)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /setujui/i })).not.toBeInTheDocument();
    expect(api.approveSkillProposal).not.toHaveBeenCalled();
  });

  it('hanya usulan milik pesan itu; tanpa usulan tidak merender apa pun', async () => {
    api.listSkillProposals.mockResolvedValue([proposal({ messageId: OTHER })]);
    const { container } = await renderScreen(
      <SkillProposalCards conversationId={CONV} messageId={MSG} />,
    );
    await vi.waitFor(() => expect(api.listSkillProposals).toHaveBeenCalled());
    expect(container.querySelector('ul')).toBeNull();
    expect(screen.queryByText(/mengusulkan/)).not.toBeInTheDocument();
  });
});

describe('kartu Usulan skill di bagian Output panel Progres', () => {
  const output: ProgressOutput = {
    kind: 'skill_proposal',
    runId: RUN,
    at: TS,
    proposalId: P1,
    name: 'Rapikan changelog',
    proposalKind: 'new',
    status: 'pending',
  };

  it('kunci, judul, dan jenis "Usulan skill"; kunci ikut status agar kartu menyegarkan diri', () => {
    expect(outputTitle(output)).toBe('Rapikan changelog');
    expect(outputKey(output)).toBe(`usulan-${P1}-pending`);
    expect(outputKey({ ...output, status: 'approved' })).not.toBe(outputKey(output));
    const onOpen = vi.fn();
    render(<OutputCards outputs={[output]} onOpen={onOpen} />);
    expect(screen.getByText(copy.progress.kinds.skill_proposal)).toBeInTheDocument();
    screen
      .getByRole('button', { name: copy.progress.openOutput('Rapikan changelog', 'Usulan skill') })
      .click();
    expect(onOpen).toHaveBeenCalledWith(output);
  });
});

describe('stripSkillProposal (saat jawaban masih mengalir)', () => {
  const block = '```aios-skill-proposal\n{"kind":"new"}\n```';

  it('membuang blok lengkap dan merapikan jarak', () => {
    expect(stripSkillProposal(`Selesai.\n\n${block}\n\nSilakan periksa.`)).toBe(
      'Selesai.\n\nSilakan periksa.',
    );
    expect(stripSkillProposal(`${block}\n\nHanya ini.`)).toBe('Hanya ini.');
  });

  it('blok yang baru dibuka dan belum ditutup tidak sempat terlihat', () => {
    expect(stripSkillProposal('Selesai.\n\n```aios-skill-proposal\n{"kind":"ne')).toBe('Selesai.');
    expect(stripSkillProposal('Selesai.\n\n```aios-skill-proposal')).toBe('Selesai.');
  });

  it('blok lain dan teks tanpa blok tidak diubah', () => {
    const ui = '```aios-ui\n{"version":1}\n```';
    expect(stripSkillProposal(ui)).toBe(ui);
    expect(stripSkillProposal('Teks biasa.\n\n\n\nJarak sengaja.')).toBe(
      'Teks biasa.\n\n\n\nJarak sengaja.',
    );
  });
});
