import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ENTER_STAGGER_MS, ENTER_STAGGER_MAX, enterProps } from './enter';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('satu judul level 2, aksi utama, dan aksi sekunder dalam satu grup', () => {
    render(
      <PageHeader
        title="Jadwal"
        primary={<button type="button">Buat jadwal</button>}
        secondary={<button type="button">Segarkan</button>}
      />,
    );
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Jadwal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat jadwal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Segarkan' })).toBeInTheDocument();
  });

  it('tanpa aksi: hanya judul', () => {
    render(<PageHeader title="Status" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('enterProps (masuk bergantian)', () => {
  it('40 ms per item dan hanya 8 item pertama', () => {
    expect(ENTER_STAGGER_MS).toBe(40);
    expect(ENTER_STAGGER_MAX).toBe(8);
    expect(enterProps(0).style).toEqual({ animationDelay: '0ms' });
    expect(enterProps(7).style).toEqual({ animationDelay: '280ms' });
    expect(enterProps(0).className).toContain('animate-aios-rise');
  });

  it('item ke-9 dan seterusnya tampil langsung tanpa animasi', () => {
    expect(enterProps(8)).toEqual({});
    expect(enterProps(50)).toEqual({});
  });
});
