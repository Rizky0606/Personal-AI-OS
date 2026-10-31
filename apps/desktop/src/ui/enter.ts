import type { CSSProperties } from 'react';

/** Jeda antar item saat daftar masuk (DESIGN_SYSTEM: 40 ms, hanya 8 item pertama). */
export const ENTER_STAGGER_MS = 40;
export const ENTER_STAGGER_MAX = 8;

/** Props untuk item daftar yang naik bergantian; item ke-9 dan seterusnya tampil langsung. */
export function enterProps(index: number): { className?: string; style?: CSSProperties } {
  if (index >= ENTER_STAGGER_MAX) return {};
  return {
    className: 'animate-aios-rise',
    style: { animationDelay: `${index * ENTER_STAGGER_MS}ms` },
  };
}
