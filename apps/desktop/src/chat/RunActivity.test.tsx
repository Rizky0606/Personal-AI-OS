import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@aios/contracts';
import { buildActivity, type Activity } from '../realtime/activity';
import { newLiveRun, reduceLiveRun, withRunStart, type LiveRun } from '../realtime/liveRun';
import { RunActivity } from './RunActivity';

interface Fixture {
  events: { ts: string; event: AgentEvent }[];
  checkpoints: { now: string; applied: number; activity: Activity }[];
}
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FIXTURES = resolve(HERE, '../../../../packages/contracts/fixtures/activity');
function activity(name: string, checkpoint = -1) {
  const f = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
  const c = checkpoint < 0 ? f.checkpoints.at(-1)! : f.checkpoints[checkpoint]!;
  let live: LiveRun = newLiveRun(name);
  for (const e of f.events.slice(0, c.applied))
    live = reduceLiveRun(live, e.event, Date.parse(e.ts));
  return buildActivity(withRunStart(live, Date.parse(c.now)), Date.parse(c.now));
}

describe('RunActivity', () => {
  it.each([
    'short-no-tools',
    'hermes-no-reasoning',
    'fourteen-tools',
    'parallel-tools',
    'waiting-approval',
    'tool-error-mid',
    'cancelled',
  ])('merender keadaan fixture %s tanpa kehilangan headline/aksi/ringkasan', (fixture) => {
    const data = activity(fixture);
    render(<RunActivity activity={data} now={Date.parse('2025-01-01T00:10:00Z')} />);
    if (data.headline) expect(screen.getByText(data.headline)).toBeInTheDocument();
    if (data.current) expect(screen.getByText(new RegExp(data.current.label))).toBeInTheDocument();
    if (data.summary) expect(screen.getByText(data.summary)).toBeInTheDocument();
  });

  it('muestra Preparando mientras no llegan eventos; sin herramientas evita una fila vacía', () => {
    const data = activity('short-no-tools');
    render(
      <RunActivity
        activity={{
          ...data,
          current: null,
          steps: [],
          stepCount: 0,
          hiddenCount: 0,
          summary: null,
          headline: null,
          phase: 'thinking',
        }}
        now={0}
      />,
    );
    expect(screen.getByText('Menyiapkan')).toBeInTheDocument();
    expect(screen.queryByText(/langkah lainnya/)).not.toBeInTheDocument();
  });

  it('abre con Enter y Espacio; el botón permanece enfocado', () => {
    const data = activity('fourteen-tools');
    render(<RunActivity activity={data} now={Date.parse('2025-01-01T00:10:00Z')} />);
    const row = screen.getByRole('button', { name: /aktivitas/i });
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: ' ' });
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('membuka otomatis untuk needsAttention dan menyediakan jalur approval yang ada', () => {
    const data = activity('waiting-approval', 0);
    const onApproval = vi.fn();
    render(
      <RunActivity activity={{ ...data, needsAttention: true }} now={0} onApproval={onApproval} />,
    );
    expect(screen.getByRole('button', { name: /aktivitas/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /approval/i }));
    expect(onApproval).toHaveBeenCalledOnce();
  });

  it('shows four artifact thumbnails and a remainder count', () => {
    const data = activity('short-no-tools');
    render(
      <RunActivity
        activity={data}
        now={0}
        artifacts={Array.from({ length: 6 }, (_, index) => ({
          fileId: `f${index}`,
          name: `shot-${index}.png`,
          mime: 'image/png',
          size: 1,
          sha256: 'a'.repeat(64),
          source: 'screenshot' as const,
        }))}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Preview/ })).toHaveLength(4);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
