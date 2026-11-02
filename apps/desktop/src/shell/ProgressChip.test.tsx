import type { ConversationProgress, TodoPhase } from '@aios/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, emit, emptyProgress, resetApi, runs } from '../test/fakeServices';
import { uid } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ProgressChip } = await import('./ProgressChip');
const { Topbar } = await import('./Topbar');

const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f11';
// Pelacak run adalah singleton: tiap tes memakai ID run sendiri supaya urutan event (seq) tidak bentrok.
let RUN = '';

const plan = (done: number, total: number): ConversationProgress => ({
  ...emptyProgress(),
  plan: {
    runId: RUN,
    phases: [
      {
        name: 'Rencana',
        tasks: Array.from({ length: total }, (_, i) => ({
          content: i === 6 ? 'Jalankan tes' : `Langkah ${i + 1}`,
          status:
            i < done
              ? ('completed' as const)
              : i === done
                ? ('in_progress' as const)
                : ('pending' as const),
        })),
      },
    ] satisfies TodoPhase[],
  },
});

const source = (runId: string | null = null) =>
  useUiStore.setState({ progressSource: { conversationId: CONV, runId, savedTools: [] } });

beforeEach(() => {
  RUN = uid();
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('ProgressChip', () => {
  it('tersembunyi bila belum ada rencana maupun langkah', async () => {
    source();
    await renderScreen(<ProgressChip />);
    await waitFor(() => expect(api.getConversationProgress).toHaveBeenCalled());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('tersembunyi tanpa percakapan terbuka', async () => {
    await renderScreen(<ProgressChip />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('"Langkah 7 dari 9": nama aksesibel memuat langkah yang sedang dikerjakan; teks angka tabular', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(plan(6, 9));
    await renderScreen(<ProgressChip />);
    const chip = await screen.findByRole('button', {
      name: 'Langkah 7 dari 9: Jalankan tes',
    });
    expect(chip).toHaveTextContent('Langkah 7 dari 9');
    expect(chip).toHaveClass('tabular-nums');
    expect(chip).toHaveAttribute('aria-keyshortcuts', 'Control+.');
  });

  it('mesin tanpa rencana: "Langkah N" tanpa total (tidak dikarang)', async () => {
    source(RUN);
    await renderScreen(<ProgressChip />);
    runs.track(RUN, CONV);
    act(() => {
      emit(`run:${RUN}`, { type: 'run.status', status: 'running' });
      emit(`run:${RUN}`, {
        type: 'tool.started',
        toolCallId: 'a',
        name: 'web_search',
        target: 'berita',
      });
      emit(
        `run:${RUN}`,
        { type: 'tool.finished', toolCallId: 'a', status: 'ok', durationMs: 5 },
        3,
      );
      emit(
        `run:${RUN}`,
        { type: 'tool.started', toolCallId: 'b', name: 'terminal', target: 'pnpm test' },
        4,
      );
    });
    const chip = await screen.findByRole('button', { name: /^Langkah 2: / });
    expect(chip).toHaveTextContent('Langkah 2');
    expect(chip).not.toHaveTextContent('dari');
  });

  it('klik membuka panel kanan di tab Progres', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(plan(2, 5));
    const user = userEvent.setup();
    await renderScreen(<ProgressChip />);
    await user.click(await screen.findByRole('button', { name: /^Langkah 3 dari 5/ }));
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
    expect(useUiStore.getState().rightPanelTab).toBe('progress');
  });

  it('Enter dan Spasi pada chip yang fokus membuka panel Progres', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(plan(0, 3));
    const user = userEvent.setup();
    await renderScreen(<ProgressChip />);
    const chip = await screen.findByRole('button', { name: /^Langkah 1 dari 3/ });
    chip.focus();
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().rightPanelTab).toBe('progress');
    useUiStore.setState({ rightPanelOpen: false, rightPanelTab: 'preview' });
    await user.keyboard(' ');
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
  });

  it('angka berganti dengan animasi gulir (kelas animasi saat berubah, hilang sesudah 180 ms)', async () => {
    source(RUN);
    api.getConversationProgress.mockResolvedValue(emptyProgress());
    await renderScreen(<ProgressChip />);
    runs.track(RUN, CONV);
    const phases = (done: number): TodoPhase[] => plan(done, 9).plan!.phases;
    act(() => {
      emit(`run:${RUN}`, { type: 'run.status', status: 'running' });
      emit(`run:${RUN}`, { type: 'todo.updated', phases: phases(0) }, 2);
    });
    await screen.findByRole('button', { name: /^Langkah 1 dari 9/ });

    act(() => emit(`run:${RUN}`, { type: 'todo.updated', phases: phases(1) }, 3));
    const chip = await screen.findByRole('button', { name: /^Langkah 2 dari 9/ });
    expect(chip.querySelector('.aios-roll-in')).not.toBeNull();
    expect(chip.querySelector('.aios-roll-out')).not.toBeNull();
    await waitFor(() => expect(chip.querySelector('.aios-roll-out')).toBeNull(), { timeout: 1000 });
  });
});

describe('Topbar: chip Progres', () => {
  const renderTopbar = (chat: boolean) =>
    renderScreen(
      <Topbar
        title="Chat"
        chat={chat}
        rightPanelOpen={false}
        onToggleRightPanel={() => undefined}
      />,
    );

  it('layar chat dengan rencana: chip tampil di kanan; layar lain: tidak ada', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(plan(6, 9));
    const view = await renderTopbar(true);
    expect(await screen.findByRole('button', { name: /^Langkah 7 dari 9/ })).toBeInTheDocument();
    view.unmount();
    await renderTopbar(false);
    expect(screen.queryByRole('button', { name: /^Langkah/ })).not.toBeInTheDocument();
  });

  it('chip tidak mengganti tombol panel kanan; keduanya ada', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(plan(0, 3));
    await renderTopbar(true);
    await screen.findByRole('button', { name: /^Langkah 1 dari 3/ });
    expect(screen.getByRole('button', { name: copy.shell.toggleRightPanel })).toBeInTheDocument();
  });
});
