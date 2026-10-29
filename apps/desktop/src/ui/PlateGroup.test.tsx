import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { PlateGroup } from './PlateGroup';

/**
 * jsdom tidak punya tata letak: posisi item dipalsukan dari atribut data-row (baris ke-n berada di y = n * 40,
 * tinggi 36), supaya yang diuji adalah perhitungan posisi pelat dari item aktif.
 */
beforeAll(() => {
  const row = (el: HTMLElement) => Number(el.dataset.row ?? 0);
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return row(this) * 40;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get: () => 8 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 200,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 36,
  });
});

const plate = (kind: 'active' | 'hover') =>
  document.querySelector<HTMLElement>(`[data-plate="${kind}"]`)!;

function List({ active }: { active: string | null }) {
  return (
    <PlateGroup activeKey={active} aria-label="daftar">
      {['a', 'b', 'c'].map((key, i) => (
        <button key={key} data-plate-key={key} data-row={i}>
          {key}
        </button>
      ))}
    </PlateGroup>
  );
}

describe('PlateGroup', () => {
  it('pelat aktif berada di item aktif: posisi dan ukuran dihitung dari item itu', () => {
    render(<List active="b" />);

    expect(plate('active')).toHaveStyle({
      transform: 'translate(8px, 40px)',
      width: '200px',
      height: '36px',
    });
    expect(plate('active')).toHaveAttribute('data-visible', 'true');
  });

  it('berpindah item aktif menggerakkan pelat yang sama (bukan membuat pelat baru)', () => {
    const { rerender } = render(<List active="a" />);
    const before = plate('active');
    expect(before).toHaveStyle({ transform: 'translate(8px, 0px)' });

    rerender(<List active="c" />);

    expect(plate('active')).toBe(before);
    expect(before).toHaveStyle({ transform: 'translate(8px, 80px)' });
  });

  it('tanpa item aktif atau kunci yang tidak ada: pelat tersembunyi', () => {
    const { rerender } = render(<List active={null} />);
    expect(plate('active')).toHaveAttribute('data-visible', 'false');
    rerender(<List active="tidak-ada" />);
    expect(plate('active')).toHaveAttribute('data-visible', 'false');
  });

  it('ukuran pertama diterapkan tanpa transisi; setelah itu transisi aktif (data-ready)', () => {
    render(<List active="a" />);

    // Efek setelah pengukuran pertama menyalakan transisi; sebelum itu pelat tidak meluncur dari pojok.
    expect(plate('active')).toHaveAttribute('data-ready', 'true');
    expect(plate('hover')).toHaveAttribute('data-ready', 'true');
  });

  it('pelat hover menyusul kursor di item lain, dan tersembunyi saat kursor di item aktif atau keluar', () => {
    render(<List active="a" />);

    fireEvent.pointerOver(screen.getByRole('button', { name: 'c' }), { pointerType: 'mouse' });
    expect(plate('hover')).toHaveStyle({ transform: 'translate(8px, 80px)' });
    expect(plate('hover')).toHaveAttribute('data-visible', 'true');

    fireEvent.pointerOver(screen.getByRole('button', { name: 'a' }), { pointerType: 'mouse' });
    expect(plate('hover')).toHaveAttribute('data-visible', 'false');

    fireEvent.pointerOver(screen.getByRole('button', { name: 'b' }), { pointerType: 'mouse' });
    expect(plate('hover')).toHaveAttribute('data-visible', 'true');
    fireEvent.pointerLeave(screen.getByLabelText('daftar'));
    expect(plate('hover')).toHaveAttribute('data-visible', 'false');
  });

  it('sentuhan tidak menggerakkan pelat hover', () => {
    render(<List active="a" />);
    fireEvent.pointerOver(screen.getByRole('button', { name: 'c' }), { pointerType: 'touch' });
    expect(plate('hover')).toHaveAttribute('data-visible', 'false');
  });

  it('pelat bersifat dekoratif: tersembunyi dari pembaca layar dan tidak menangkap pointer', () => {
    render(<List active="a" />);
    for (const kind of ['active', 'hover'] as const) {
      expect(plate(kind)).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
