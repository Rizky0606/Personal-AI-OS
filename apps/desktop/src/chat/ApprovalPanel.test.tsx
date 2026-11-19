import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import type { PendingApproval } from '../realtime/liveRun';
import { ApprovalPanel } from './ApprovalPanel';

const approval = (over: Partial<PendingApproval>): PendingApproval => ({
  approvalId: 'a1',
  kind: 'command',
  detail: 'npm test',
  cwd: '/repo',
  toolCallId: undefined,
  ...over,
});

const show = (over: Partial<PendingApproval>) =>
  render(<ApprovalPanel approval={approval(over)} busy={false} onResolve={vi.fn()} />);

describe('ApprovalPanel', () => {
  it('tulis berkas baru dan ubah berkas tampil sama: jalur berkas, isi baru bisa dibuka', async () => {
    const user = userEvent.setup();
    const view = show({
      kind: 'file_write',
      detail: 'Path: catatan.txt\nContent:\nbaris 1\nbaris 2\n',
    });
    const panel = screen.getByRole('group', { name: copy.approval.title.file_write });
    expect(within(panel).getByText('catatan.txt')).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/Path:|Content:/);
    await user.click(within(panel).getByText(copy.approval.showContent(2)));
    expect(within(panel).getByText(/baris 1\s+baris 2/)).toBeVisible();
    view.unmount();

    show({ kind: 'file_write', detail: 'File: src/util/format.ts' });
    const edit = screen.getByRole('group', { name: copy.approval.title.file_write });
    expect(within(edit).getByText('src/util/format.ts')).toBeInTheDocument();
    expect(edit.textContent).not.toMatch(/File:/);
    expect(within(edit).queryByText(/Lihat isi baru/)).toBeNull();
  });

  it('"Selalu" pada tulis berkas menjelaskan bahwa izinnya berlaku untuk semua penulisan di project', () => {
    show({ kind: 'file_write', detail: 'File: a.ts' });
    expect(screen.getByText(copy.approval.fileWriteHint)).toBeInTheDocument();
    expect(screen.queryByText(copy.approval.alwaysHint)).toBeNull();
  });

  it('spawn subagent omp (tool task) berlabel subagent, bukan perintah', () => {
    show({
      detail:
        'Context:\nKonteks bersama\nBatch agents: scout ×2\nAgent: scout\nTask:\nCari pemakai render.',
    });
    const panel = screen.getByRole('group', { name: copy.approval.subagentTitle });
    expect(within(panel).getByText('scout ×2')).toBeInTheDocument();
    expect(within(panel).getByLabelText(copy.approval.subagentTask)).toHaveTextContent(
      'Cari pemakai render.',
    );
    expect(within(panel).getByText(copy.approval.subagentHint)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: copy.approval.title.command })).toBeNull();
  });

  it('perintah biasa tetap: judul perintah, isi persis, dan petunjuk cocok persis', () => {
    show({ detail: 'npm test -- --run' });
    const panel = screen.getByRole('group', { name: copy.approval.title.command });
    expect(within(panel).getByLabelText('Perintah')).toHaveTextContent('npm test -- --run');
    expect(within(panel).getByText(copy.approval.alwaysHint)).toBeInTheDocument();
  });
});
