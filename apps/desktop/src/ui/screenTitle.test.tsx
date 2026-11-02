import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PageHeader as PageLayoutHeader } from '../screens/PageLayout';
import { PageHeader } from './PageHeader';
import { ScreenTitleContext } from './screenTitle';

/** Meniru Shell: pemilik judul tunggal (h1) yang menerima judul dari layar. */
function Owner({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <ScreenTitleContext.Provider value={setTitle}>
      <h1>{title ?? 'Bagian'}</h1>
      {children}
    </ScreenTitleContext.Provider>
  );
}

describe('aturan judul tunggal per layar', () => {
  it('di dalam Shell, PageHeader (layar) mendaftarkan judulnya ke pemilik dan tidak merender h2', () => {
    render(
      <Owner>
        <PageLayoutHeader
          title="Jadwal"
          description="Tugas berulang."
          actions={<button type="button">Buat jadwal</button>}
        />
      </Owner>,
    );
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Jadwal' })).toBeInTheDocument();
    // Deskripsi dan aksi tetap ada.
    expect(screen.getByText('Tugas berulang.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat jadwal' })).toBeInTheDocument();
  });

  it('di dalam Shell, PageHeader (ui) mendaftarkan judul; tanpa aksi tidak merender apa pun', () => {
    const { container } = render(
      <Owner>
        <PageHeader title="Pengaturan" />
      </Owner>,
    );
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Pengaturan' })).toBeInTheDocument();
    expect(container.querySelector('[data-page-header]')).toBeNull();
  });

  it('PageHeader (ui) dengan aksi: aksi tetap tampil tanpa judul kedua', () => {
    render(
      <Owner>
        <PageHeader title="Pengaturan" primary={<button type="button">Simpan</button>} />
      </Owner>,
    );
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeInTheDocument();
  });

  it('judul pulih ke nama bagian saat layar dilepas', () => {
    const { rerender } = render(
      <Owner>
        <PageLayoutHeader title="Detail jadwal" />
      </Owner>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Detail jadwal' })).toBeInTheDocument();
    rerender(<Owner>{null}</Owner>);
    expect(screen.getByRole('heading', { level: 1, name: 'Bagian' })).toBeInTheDocument();
  });

  it('judul berubah mengikuti data (mis. nama jadwal selesai dimuat)', () => {
    const { rerender } = render(
      <Owner>
        <PageLayoutHeader title="Jadwal" />
      </Owner>,
    );
    rerender(
      <Owner>
        <PageLayoutHeader title="Ringkasan harian" />
      </Owner>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Ringkasan harian' })).toBeInTheDocument();
  });

  it('di luar Shell (tes layar, katalog) PageHeader tetap merender judulnya sendiri', () => {
    render(<PageLayoutHeader title="Jadwal" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Jadwal' })).toBeInTheDocument();
  });

  it('judul bukan teks (ReactNode) tidak didelegasikan', () => {
    render(
      <Owner>
        <PageLayoutHeader
          title={
            <>
              Kanban <em>Toko</em>
            </>
          }
        />
      </Owner>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Kanban Toko');
    expect(screen.getByRole('heading', { level: 1, name: 'Bagian' })).toBeInTheDocument();
  });
});
