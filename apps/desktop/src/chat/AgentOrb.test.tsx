import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentOrb, orbStateOf } from './AgentOrb';

describe('AgentOrb', () => {
  it.each(['idle', 'thinking', 'tool', 'writing', 'done', 'error'] as const)(
    '%s tetap ornamen tersembunyi dari pembaca layar',
    (state) => {
      render(<AgentOrb state={state} />);
      expect(screen.getByTestId('agent-orb')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByTestId('agent-orb')).toHaveAttribute('data-state', state);
      expect(screen.queryByTitle(/./)).not.toBeInTheDocument();
    },
  );

  it('mengubah fase pada SVG yang sama, dengan check khusus fase selesai', () => {
    const view = render(<AgentOrb state="thinking" />);
    const orb = screen.getByTestId('agent-orb');
    view.rerender(<AgentOrb state="done" />);
    expect(screen.getByTestId('agent-orb')).toBe(orb);
    expect(orb.querySelector('[data-orb-check]')).toHaveAttribute('pathLength', '1');
  });

  it('mendukung ukuran ringkas 16 dan penuh 28', () => {
    const view = render(<AgentOrb state="idle" size={16} />);
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('width', '16');
    view.rerender(<AgentOrb state="idle" size={28} />);
    expect(screen.getByTestId('agent-orb')).toHaveAttribute('width', '28');
  });

  it.each([
    ['idle', 'idle'],
    ['thinking', 'thinking'],
    ['tool', 'tool'],
    ['writing', 'writing'],
    ['waiting_approval', 'tool'],
    ['done', 'done'],
    ['error', 'error'],
    ['cancelled', 'idle'],
  ] as const)('memetakan fase %s ke orb %s', (phase, state) => {
    expect(orbStateOf(phase)).toBe(state);
  });
});
