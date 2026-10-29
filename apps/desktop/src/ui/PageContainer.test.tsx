import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContainer } from './PageContainer';

function container() {
  const el = document.querySelector('[data-page-container]');
  if (!(el instanceof HTMLElement)) throw new Error('PageContainer tidak dirender');
  return el;
}

describe('PageContainer', () => {
  it('merender anak di dalam wadah halaman', () => {
    render(
      <PageContainer>
        <p>isi halaman</p>
      </PageContainer>,
    );
    expect(container()).toContainElement(screen.getByText('isi halaman'));
  });

  it('memakai lebar maksimum dari token dan berada di tengah', () => {
    render(<PageContainer>x</PageContainer>);
    const classes = container().className.split(/\s+/);
    expect(classes).toContain('max-w-(--aios-page-measure)');
    expect(classes).toContain('mx-auto');
    expect(classes).toContain('w-full');
    expect(classes).not.toContain('max-w-xl');
  });

  it('memberi jarak dalam dan antar bagian yang seragam', () => {
    render(<PageContainer>x</PageContainer>);
    const classes = container().className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-6', 'px-6', 'py-6']));
  });

  it('menggabungkan className tambahan tanpa menghilangkan kelas dasar', () => {
    render(<PageContainer className="pb-16">x</PageContainer>);
    const classes = container().className.split(/\s+/);
    expect(classes).toContain('pb-16');
    expect(classes).toContain('max-w-(--aios-page-measure)');
  });
});
