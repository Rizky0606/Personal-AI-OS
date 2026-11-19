import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../lib/external', () => ({ openExternal, saveBlob: vi.fn() }));

const { Markdown } = await import('./Markdown');

beforeEach(() => openExternal.mockClear());

describe('Markdown', () => {
  it('judul, daftar, tabel, dan kutipan dirender sebagai elemen semantik', () => {
    render(
      <Markdown
        source={'## Bagian\n\n- satu\n- dua\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n> kutip'}
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Bagian' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
    expect(screen.getByText('kutip').closest('blockquote')).not.toBeNull();
  });

  it('HTML mentah tidak dieksekusi: tampil sebagai teks', () => {
    const { container } = render(<Markdown source={'<img src=x onerror=alert(1)> <b>tebal</b>'} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('tautan dibuka lewat openExternal, tidak menavigasi webview', async () => {
    const user = userEvent.setup();
    render(<Markdown source="[Bun](https://bun.sh)" />);

    await user.click(screen.getByRole('link', { name: 'Bun' }));

    expect(openExternal).toHaveBeenCalledWith('https://bun.sh');
  });

  it('tautan dengan skema berbahaya tidak menjadi tautan', () => {
    render(<Markdown source="[klik](javascript:alert(1))" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('rujukan [n] hanya jadi tautan bila ada di peta; yang lain tetap teks', () => {
    render(<Markdown source="Fakta [1] dan [9]." citations={new Map([[1, 'https://a.com']])} />);

    expect(screen.getByRole('link', { name: 'Rujukan 1: buka sumber' })).toHaveTextContent('[1]');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText(/dan \[9\]\./)).toBeInTheDocument();
  });

  it('blok kode menampilkan bahasa dan tombol salin yang menyalin isinya', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Markdown source={'```ts\nconst a = 1;\n```'} />);

    expect(screen.getByText('ts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.chat.copy }));

    expect(writeText).toHaveBeenCalledWith('const a = 1;');
    expect(await screen.findByRole('button', { name: copy.chat.copied })).toBeInTheDocument();
  });

  it('pagar kode yang belum ditutup (streaming) tetap dirender', () => {
    render(<Markdown source={'```py\nprint(1)'} />);

    expect(screen.getByText('print(1)')).toBeInTheDocument();
  });

  it('blok aios-ui dari laporan uji (chartType/title/max) diperbaiki lalu tampil sebagai grafik', () => {
    const json =
      '{"version":1,"components":[{"id":"popularitas-db","type":"chart","chartType":"bar","title":"Skor popularitas","labels":["PostgreSQL","MySQL"],"values":[9,8],"max":10}]}';
    const { container } = render(<Markdown source={'```aios-ui\n' + json + '\n```'} />);

    expect(
      screen.getByRole('figure', { name: 'Skor popularitas: PostgreSQL 9, MySQL 8' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(copy.richFallback.noteWithData)).not.toBeInTheDocument();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('blok aios-ui yang tetap tidak valid tampil sebagai data tabel, JSON mentah tertutup', () => {
    // Nilai bukan angka tidak bisa diperbaiki: grafik tidak mungkin, datanya tetap terbaca.
    const json =
      '{"version":1,"components":[{"type":"chart","chartType":"bar","title":"Skor popularitas","labels":["PostgreSQL","MySQL"],"values":["tinggi","sedang"]}]}';
    const { container } = render(<Markdown source={'```aios-ui\n' + json + '\n```'} />);

    expect(screen.getByText(copy.richFallback.noteWithData)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Skor popularitas' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'PostgreSQL' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'tinggi' })).toBeInTheDocument();
    // JSON mentah hanya ada di balik disclosure yang tertutup, bukan blok kode utama.
    expect(screen.queryByRole('button', { name: copy.chat.copy })).not.toBeInTheDocument();
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')).toHaveTextContent(copy.richFallback.showRaw);
    expect(details?.querySelector('pre')).toHaveTextContent('chartType');
  });

  it('blok aios-ui yang bukan JSON hanya menampilkan keterangan', () => {
    const { container } = render(<Markdown source={'```aios-ui\n{bukan json\n```'} />);

    expect(screen.getByText(copy.richFallback.note)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(container.querySelector('details')?.open).toBe(false);
  });
});
