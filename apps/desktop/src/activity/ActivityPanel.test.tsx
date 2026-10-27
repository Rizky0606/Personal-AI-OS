import type { Message } from '@aios/contracts';
import { screen, within } from '@testing-library/react';
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
        { id: 'x', name: 'grep', target: 'f', status: 'running' as const, durationMs: undefined },
      ],
    };
    expect(activitySteps(live, [toolMessage()]).map((s) => s.id)).toEqual(['x']);
    expect(activitySteps(newLiveRun('r1'), [toolMessage()]).map((s) => s.id)).toEqual(['t1']);
    expect(activitySteps(undefined, [])).toEqual([]);
  });
});
