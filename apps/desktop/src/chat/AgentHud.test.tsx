import type { TodoPhase } from '@aios/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { newLiveRun, type LiveRun, type SubagentView } from '../realtime/liveRun';
import { useUiStore } from '../state/uiStore';
import { AgentHud } from './AgentHud';

const RUN = '0192f0c4-7a1b-7c2d-a00a-4a5b6c7d8e9a';

const phases: TodoPhase[] = [
  {
    name: 'Tahap',
    tasks: [
      { content: 'Baca kode', status: 'completed' },
      { content: 'Tulis tes', status: 'in_progress' },
      { content: 'Jalankan lint', status: 'pending' },
    ],
  },
];

const subagent: SubagentView = {
  subagentId: 'Pekerja',
  agent: 'task',
  assignment: 'Baca a.txt',
  status: 'running',
  toolCount: 1,
  durationMs: 1200,
  tokens: 10,
};

const run = (patch: Partial<LiveRun>): LiveRun => ({
  ...newLiveRun(RUN),
  status: 'running',
  ...patch,
});

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('Agent HUD', () => {
  it('tersembunyi total bila tidak ada rencana, antrean, maupun subagent', () => {
    const { container, rerender } = render(<AgentHud live={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AgentHud live={run({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('terbuka secara bawaan: rencana dengan kemajuan, antrean, dan ringkasan di header', () => {
    render(
      <AgentHud
        live={run({
          todos: phases,
          queue: { steering: ['fokus ke tes'], followUp: ['lalu lint'] },
          subagents: [subagent],
        })}
      />,
    );
    const toggle = screen.getByRole('button', { expanded: true, name: /Agent bekerja/ });
    expect(toggle).toHaveTextContent('1/3 tugas · 2 antre · 1 subagent');

    const plan = screen.getByRole('region', { name: copy.chat.todo.title });
    expect(within(plan).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    const queue = screen.getByRole('list', { name: copy.chat.queue.title });
    expect(within(queue).getByText('fokus ke tes')).toBeInTheDocument();
    expect(within(queue).getByText('lalu lint')).toBeInTheDocument();
  });

  it('tombol lipat menyembunyikan isi tetapi header tetap tampil', async () => {
    const user = userEvent.setup();
    render(<AgentHud live={run({ todos: phases })} />);

    await user.click(screen.getByRole('button', { name: /Agent bekerja/ }));

    expect(screen.getByRole('button', { name: /Agent bekerja/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('region', { name: copy.chat.todo.title })).not.toBeInTheDocument();
  });

  it('tombol tarik mengirim antrean dan teks persis', async () => {
    const user = userEvent.setup();
    const onRemoveQueued = vi.fn();
    render(
      <AgentHud
        live={run({ queue: { steering: ['fokus ke tes'], followUp: ['lalu lint'] } })}
        onRemoveQueued={onRemoveQueued}
      />,
    );

    await user.click(screen.getByRole('button', { name: copy.chat.queue.remove('lalu lint') }));
    expect(onRemoveQueued).toHaveBeenLastCalledWith('followUp', 'lalu lint');
    await user.click(screen.getByRole('button', { name: copy.chat.queue.remove('fokus ke tes') }));
    expect(onRemoveQueued).toHaveBeenLastCalledWith('steering', 'fokus ke tes');
  });

  it('chip subagent membuka tab Aktivitas', async () => {
    const user = userEvent.setup();
    render(<AgentHud live={run({ subagents: [subagent] })} />);

    await user.click(screen.getByRole('button', { name: copy.chat.hud.openActivity(1) }));

    const ui = useUiStore.getState();
    expect(ui.rightPanelOpen).toBe(true);
    expect(ui.rightPanelTab).toBe('activity');
  });
});
