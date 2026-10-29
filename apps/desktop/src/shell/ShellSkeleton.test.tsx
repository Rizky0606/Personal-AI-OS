import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { ShellSkeleton } from './ShellSkeleton';

describe('ShellSkeleton (state memuat awal)', () => {
  it('kerangka pulau dengan shimmer, bukan layar kosong; diumumkan sebagai status memuat', () => {
    const { container } = render(<ShellSkeleton />);

    expect(screen.getByRole('status', { name: copy.shell.loading })).toBeInTheDocument();
    // Dua pulau (sidebar dan area utama), masing-masing dengan sapuan shimmer.
    expect(container.querySelectorAll('.aios-island-shimmer')).toHaveLength(2);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(8);
  });

  it('tidak interaktif dan tidak memuat teks UI selain nama statusnya', () => {
    const { container } = render(<ShellSkeleton />);

    expect(container.querySelectorAll('button, a, input')).toHaveLength(0);
    expect(container.textContent).toBe('');
  });
});
