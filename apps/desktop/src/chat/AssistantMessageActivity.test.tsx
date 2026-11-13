import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RoleInfo } from '../api/gateway';
import { copy } from '../copy';
import { formatElapsed, savedActivity, type SavedTool } from '../realtime/activity';
import { allCheckpoints, fixtureActivity } from '../test/activityFixtures';
import { orbStateOf } from './AgentOrb';
import { AssistantMessage } from './AssistantMessage';

const ui = copy.runActivity.ui;
const baseProps = { role: 'general', model: null, roles: [] as RoleInfo[] };
const text = [{ type: 'text' as const, text: 'Isi jawaban.' }];
/** Checkpoint fixture emas yang sedang menjalankan tool dengan beberapa langkah sebelumnya. */
const runningActivity = () =>
  allCheckpoints().find((c) => c.activity.current !== null && c.activity.stepCount >= 3)!.activity;
const DURATION = /\d+(,\d)? (ms|dtk)/;
const SETTLED = ['done', 'error', 'cancelled'];
const follows = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('baris aktivitas di dalam jawaban', () => {
  it('tanpa run: tidak ada baris aktivitas, dan chip tool tidak pernah tampil di luar linimasa', () => {
    render(
      <AssistantMessage
        {...baseProps}
        parts={[
          {
            type: 'tool',
            id: 't1',
            name: 'read',
            target: 'src/a.ts',
            status: 'ok',
            durationMs: 340,
          },
          ...text,
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: new RegExp(ui.toggle) })).not.toBeInTheDocument();
    expect(screen.queryByText('read')).not.toBeInTheDocument();
    expect(screen.getByText('Isi jawaban.')).toBeInTheDocument();
  });

  it('urutan di kolom jawaban: meta, judul, baris aktivitas, lalu isi; satu kolom baca yang sama', () => {
    const activity = fixtureActivity('short-no-tools', 0);
    const { container } = render(
      <AssistantMessage {...baseProps} parts={text} run={{ activity, now: 0 }} />,
    );
    const meta = container.querySelector('article header')!;
    const row = screen.getByRole('button', { name: new RegExp(ui.toggle) });
    const body = screen.getByText('Isi jawaban.');
    expect(follows(meta, row)).toBe(true);
    expect(follows(row, body)).toBe(true);
    if (activity.headline) {
      const headline = screen.getByText(activity.headline);
      expect(follows(meta, headline)).toBe(true);
      expect(follows(headline, row)).toBe(true);
    }
    const column = meta.parentElement!;
    expect(column).toHaveClass('max-w-(--aios-chat-measure)');
    expect(column).toContainElement(row);
    expect(column).toContainElement(body);
  });

  it('Orb 28 di avatar mengikuti prop orb; bawaan done, thinking saat mengalir', () => {
    const { rerender } = render(<AssistantMessage {...baseProps} parts={text} />);
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('width', '28');
    rerender(<AssistantMessage {...baseProps} parts={text} streaming />);
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'thinking');
    rerender(<AssistantMessage {...baseProps} parts={text} streaming orb="tool" />);
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'tool');
    rerender(<AssistantMessage {...baseProps} parts={text} orb="error" />);
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', 'error');
  });

  // Semua checkpoint semua fixture emas: tiap fase terwakili dan baris selalu bisa dirender utuh.
  it.each(
    allCheckpoints().map(
      (c) => [`${c.name}#${c.index} (${c.activity.phase})`, c.activity] as const,
    ),
  )(
    'fixture emas %s: Orb, judul, aksi atau ringkasan tampil di dalam jawaban',
    (_label, activity) => {
      const settled = SETTLED.includes(activity.phase);
      render(
        <AssistantMessage
          {...baseProps}
          parts={text}
          streaming={!settled}
          orb={orbStateOf(activity.phase)}
          run={{ activity, now: 0 }}
        />,
      );
      expect(screen.getByTestId('agent-orb')).toHaveAttribute(
        'data-state',
        orbStateOf(activity.phase),
      );
      const row = screen.getByRole('button', { name: new RegExp(ui.toggle) });
      if (activity.headline) expect(screen.getByText(activity.headline)).toBeInTheDocument();
      if (settled && activity.summary) expect(row).toHaveTextContent(activity.summary);
      else if (activity.current && activity.phase !== 'waiting_approval')
        expect(row).toHaveTextContent(activity.current.label);
      else expect(row).toHaveTextContent(ui.phase[activity.phase]);
    },
  );

  it('fase yang tidak ada di fixture ikut diuji: idle dan error', () => {
    const base = fixtureActivity('short-no-tools', 0);
    for (const phase of ['idle', 'error'] as const) {
      const { unmount } = render(
        <AssistantMessage
          {...baseProps}
          parts={text}
          orb={orbStateOf(phase)}
          run={{
            activity: { ...base, phase, current: null, headline: null, summary: null },
            now: 0,
          }}
        />,
      );
      expect(screen.getByRole('button', { name: new RegExp(ui.toggle) })).toHaveTextContent(
        ui.phase[phase],
      );
      expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', orbStateOf(phase));
      unmount();
    }
  });

  it('langkah yang masih berjalan tidak menampilkan durasi (bukan "0 ms"); yang selesai menampilkannya', async () => {
    const user = userEvent.setup();
    const activity = runningActivity();
    render(<AssistantMessage {...baseProps} parts={text} streaming run={{ activity, now: 0 }} />);
    await user.click(screen.getByRole('button', { name: new RegExp(ui.toggle) }));
    const items = within(screen.getByRole('list', { name: ui.timeline })).getAllByRole('listitem');
    activity.steps.forEach((step, i) => {
      if (step.status === 'running') expect(items[i]).not.toHaveTextContent(DURATION);
      else if (step.durationMs !== null) expect(items[i]).toHaveTextContent(DURATION);
    });
    expect(activity.steps.some((s) => s.status === 'running')).toBe(true);
  });

  it('aria-live hanya pada judul; baris, timer, dan linimasa tidak diumumkan', () => {
    const activity = runningActivity();
    const { container } = render(
      <AssistantMessage {...baseProps} parts={text} streaming run={{ activity, now: 0 }} />,
    );
    const live = container.querySelectorAll('[aria-live]');
    expect(live).toHaveLength(activity.headline ? 1 : 0);
    if (activity.headline) expect(live[0]).toHaveTextContent(activity.headline);
    expect(
      screen.getByRole('button', { name: new RegExp(ui.toggle) }).closest('[aria-live]'),
    ).toBeNull();
  });

  it('keyboard: Enter dan Spasi membuka dan menutup linimasa; fokus tetap di tombol', async () => {
    const user = userEvent.setup();
    const activity = runningActivity();
    render(<AssistantMessage {...baseProps} parts={text} streaming run={{ activity, now: 0 }} />);
    const row = screen.getByRole('button', { name: new RegExp(ui.toggle) });
    expect(screen.queryByRole('list', { name: ui.timeline })).not.toBeInTheDocument();

    row.focus();
    await user.keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveFocus();
    const timeline = screen.getByRole('list', { name: ui.timeline });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(activity.steps.length);
    await user.keyboard(' ');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: ui.timeline })).not.toBeInTheDocument();
  });

  it('baris terlipat saat berjalan: aksi saat ini, target redup, timer, dan +N langkah sebelumnya', () => {
    const activity = runningActivity();
    expect(activity.current).not.toBeNull();
    render(<AssistantMessage {...baseProps} parts={text} streaming run={{ activity, now: 0 }} />);
    const row = screen.getByRole('button', { name: new RegExp(ui.toggle) });
    expect(row).toHaveTextContent(activity.current!.label);
    if (activity.current!.target) expect(row).toHaveTextContent(activity.current!.target);
    expect(row).toHaveTextContent(formatElapsed(activity.elapsedMs));
    expect(row).toHaveTextContent(`+${activity.stepCount - 1}`);
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('izin menunggu: linimasa terbuka sendiri dan tombol menuju panel izin dipanggil', async () => {
    const user = userEvent.setup();
    const onApproval = vi.fn();
    const activity = fixtureActivity('waiting-approval', 0);
    expect(activity.phase).toBe('waiting_approval');
    render(
      <AssistantMessage
        {...baseProps}
        parts={text}
        streaming
        run={{ activity, now: 0, onApproval }}
      />,
    );
    expect(screen.getByRole('button', { name: new RegExp(ui.toggle) })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.click(screen.getByRole('button', { name: new RegExp(ui.openApproval) }));
    expect(onApproval).toHaveBeenCalledOnce();
  });
});

describe('jawaban lama: ringkasan dari data tersimpan', () => {
  const tools: SavedTool[] = [
    { id: 't1', name: 'read_file', target: 'src/a.ts', status: 'ok', durationMs: 340 },
    { id: 't2', name: 'terminal', target: 'pnpm test', status: 'error', durationMs: 1200 },
  ];
  const props = { ...baseProps, parts: text };
  const timed = (status: 'completed' | 'failed' | 'cancelled' | 'needs_review', end: string) => ({
    status,
    createdAt: '2026-11-02T10:00:00Z',
    updatedAt: end,
  });

  it('Selesai · durasi · N langkah dari waktu run; terlipat, membuka linimasa dengan durasi tiap langkah', async () => {
    const user = userEvent.setup();
    const activity = savedActivity(tools, timed('completed', '2026-11-02T10:01:05Z'));
    render(<AssistantMessage {...props} orb="done" run={{ activity, now: 0 }} />);
    const row = screen.getByRole('button', { name: new RegExp(ui.toggle) });
    expect(row).toHaveTextContent('Selesai · 1 mnt 05 dtk · 2 langkah');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: ui.timeline })).not.toBeInTheDocument();

    await user.click(row);
    const items = within(screen.getByRole('list', { name: ui.timeline })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('340 ms');
    expect(items[0]).toHaveTextContent('src/a.ts');
    expect(items[1]).toHaveTextContent('1,2 dtk');
  });

  it('tanpa data run: hanya jumlah langkah, durasi tidak dikarang', () => {
    const activity = savedActivity(tools, null);
    expect(activity.summary).toBe('Selesai · 2 langkah');
    expect(activity.summary).not.toMatch(/dtk|mnt/);
  });

  it('run needs_review: durasi tidak dihitung karena updatedAt berubah saat peninjauan', () => {
    expect(savedActivity(tools, timed('needs_review', '2026-11-02T12:00:00Z')).summary).toBe(
      'Selesai · 2 langkah',
    );
  });

  it('run gagal: Gagal dengan durasi dan fase error; dibatalkan: Dibatalkan', () => {
    const failed = savedActivity(tools, timed('failed', '2026-11-02T10:00:08Z'));
    expect(failed.phase).toBe('error');
    expect(failed.summary).toBe('Gagal · 8 dtk · 2 langkah');
    expect(savedActivity(tools, timed('cancelled', '2026-11-02T10:00:03Z')).summary).toBe(
      'Dibatalkan · 3 dtk · 2 langkah',
    );
  });

  it('selisih waktu negatif atau tidak terbaca tidak menghasilkan durasi; tanpa langkah tanpa bagian langkah', () => {
    expect(savedActivity(tools, timed('completed', '2026-11-02T09:00:00Z')).summary).toBe(
      'Selesai · 2 langkah',
    );
    expect(
      savedActivity(tools, { status: 'completed', createdAt: 'x', updatedAt: 'y' }).summary,
    ).toBe('Selesai · 2 langkah');
    expect(savedActivity([], timed('completed', '2026-11-02T10:00:04Z')).summary).toBe(
      'Selesai · 4 dtk',
    );
  });

  it('jawaban lama tetap terlipat walau ada langkah galat', () => {
    expect(savedActivity(tools, null).needsAttention).toBe(false);
  });
});
