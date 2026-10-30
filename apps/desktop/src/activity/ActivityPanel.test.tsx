import type { Message } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { newLiveRun } from '../realtime/liveRun';
import { useUiStore } from '../state/uiStore';
import { message } from '../test/fixtures';
import { renderScreen } from '../test/render';
import { ActivityPanel } from './ActivityPanel';
import { activitySteps } from './steps';

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('ActivityPanel', () => {
  it('tanpa langkah agent: keadaan kosong', async () => {
    await renderScreen(<ActivityPanel />);
    expect(screen.getByText(copy.activity.empty)).toBeInTheDocument();
  });

  it('menampilkan yang sedang dikerjakan, berkas yang disentuh, dan langkah lain', async () => {
    useUiStore.getState().setAgentSteps([
      { id: '1', name: 'read', target: 'src/App.tsx', status: 'ok' },
      { id: '2', name: 'grep', target: 'TODO', status: 'ok' },
      { id: '3', name: 'edit', target: 'src/App.tsx', status: 'ok' },
      { id: '4', name: 'read', target: 'package.json', status: 'running' },
    ]);
    await renderScreen(<ActivityPanel />);

    const now = screen.getByRole('region', { name: copy.activity.now });
    expect(within(now).getByText('package.json')).toBeInTheDocument();

    const files = screen.getByRole('region', { name: copy.activity.files });
    const items = within(files).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('package.json');
    expect(items[0]).toHaveTextContent(copy.activity.read);
    expect(items[1]).toHaveTextContent('src/App.tsx');
    expect(items[1]).toHaveTextContent(copy.activity.edit);

    const steps = screen.getByRole('region', { name: copy.activity.steps });
    expect(within(steps).getByText('grep')).toBeInTheDocument();
  });

  it('subagent tampil sebagai daftar bersimpul dengan status, tugas, jumlah tool, dan keluaran terakhir', async () => {
    useUiStore.getState().setAgentSteps([{ id: '1', name: 'task', status: 'running' }]);
    useUiStore.getState().setAgentSubagents([
      {
        subagentId: 'Pekerja',
        agent: 'task',
        assignment: 'Baca a.txt',
        status: 'running',
        toolCount: 2,
        durationMs: 1500,
        tokens: 30,
        lastOutput: 'membaca berkas',
      },
      {
        subagentId: 'Peninjau',
        agent: 'scout',
        assignment: 'Periksa tes',
        status: 'failed',
        toolCount: 0,
        durationMs: 0,
        tokens: 0,
      },
    ]);
    await renderScreen(<ActivityPanel />);

    const tree = screen.getByRole('region', { name: copy.activity.subagents.title });
    const items = within(tree).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Pekerja');
    expect(items[0]).toHaveTextContent(copy.activity.subagents.status.running);
    expect(items[0]).toHaveTextContent(copy.activity.subagents.tools(2));
    expect(items[0]).toHaveTextContent('1,5 dtk');
    expect(items[0]).toHaveTextContent('membaca berkas');
    expect(items[1]).toHaveTextContent(copy.activity.subagents.status.failed);
  });

  it('klik berkas membuka tab Berkas dengan permintaan membuka berkas itu; berkas diubah punya tombol Diff', async () => {
    useUiStore
      .getState()
      .setAgentSteps([{ id: '1', name: 'edit', target: 'src/a.ts', status: 'ok' }]);
    const user = userEvent.setup();
    await renderScreen(<ActivityPanel />);

    await user.click(screen.getByRole('button', { name: `${copy.activity.open}: src/a.ts` }));
    expect(useUiStore.getState().fileRequest).toMatchObject({ path: 'src/a.ts' });
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
    expect(useUiStore.getState().rightPanelTab).toBe('files');

    await user.click(screen.getByRole('button', { name: `${copy.activity.diff}: src/a.ts` }));
    expect(useUiStore.getState().rightPanelTab).toBe('diff');
  });
});

describe('activitySteps', () => {
  const toolMessage = (): Message =>
    message({
      author: 'assistant',
      parts: [
        { type: 'tool', toolCallId: 't1', name: 'read', target: 'a.ts', status: 'ok' },
        { type: 'text', text: 'selesai' },
      ],
    });

  it('memakai aliran live bila ada langkahnya; bila tidak, jawaban asisten terakhir', () => {
    const live = {
      ...newLiveRun('r1'),
      tools: [
        {
          id: 'x',
          name: 'grep',
          target: 'f',
          status: 'running' as const,
          durationMs: undefined,
          startedAt: null,
        },
      ],
    };
    expect(activitySteps(live, [toolMessage()]).map((s) => s.id)).toEqual(['x']);
    expect(activitySteps(newLiveRun('r1'), [toolMessage()]).map((s) => s.id)).toEqual(['t1']);
    expect(activitySteps(undefined, [])).toEqual([]);
  });
});

describe('ActivityPanel: aksi keadaan kosong', () => {
  it('tombol Mulai percakapan meminta chat baru dan membuka layar chat', async () => {
    const user = userEvent.setup();
    const before = useUiStore.getState().newChatSignal;
    const { router } = await renderScreen(<ActivityPanel />, '/status');
    await user.click(screen.getByRole('button', { name: copy.activity.start }));
    expect(useUiStore.getState().newChatSignal).toBe(before + 1);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
