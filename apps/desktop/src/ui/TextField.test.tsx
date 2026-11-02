import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField: lebar', () => {
  it('input selalu selebar ruas induknya (w-full), dengan atau tanpa kontrol di dalam ruas', () => {
    render(
      <>
        <TextField label="Polos" />
        <TextField label="Dengan tombol" trailing={<button type="button">Lihat</button>} />
      </>,
    );
    expect(screen.getByLabelText('Polos')).toHaveClass('w-full');
    expect(screen.getByLabelText('Polos')).not.toHaveClass('pr-10');
    expect(screen.getByLabelText('Dengan tombol')).toHaveClass('w-full', 'pr-10');
  });

  it('className dari pemanggil tetap bisa menambah gaya tanpa menghilangkan lebar penuh', () => {
    render(<TextField label="Kustom" className="font-mono" />);
    expect(screen.getByLabelText('Kustom')).toHaveClass('w-full', 'font-mono');
  });
});
