import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { connectionView } from './StatusBar';

describe('connectionView', () => {
  it('menurut status koneksi gateway', () => {
    expect(connectionView({ kind: 'connected' }, true)).toEqual({
      label: copy.status.connected,
      tone: 'success',
    });
    expect(connectionView({ kind: 'connecting' }, true)).toEqual({
      label: copy.status.connecting,
      tone: 'warning',
    });
    expect(connectionView({ kind: 'reconnecting', attempt: 2 }, true)).toEqual({
      label: copy.status.reconnecting,
      tone: 'warning',
    });
    expect(connectionView({ kind: 'idle' }, true)).toEqual({
      label: copy.status.idle,
      tone: 'muted',
    });
  });

  it('PC offline mengalahkan status gateway', () => {
    expect(connectionView({ kind: 'connected' }, false)).toEqual({
      label: copy.status.offline,
      tone: 'warning',
    });
  });
});
