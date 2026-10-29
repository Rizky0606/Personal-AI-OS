import { copy } from '../copy';
import type { ConnectionState } from '../realtime/client';

export interface ConnectionView {
  label: string;
  tone: 'success' | 'warning' | 'muted';
}

/** Status koneksi untuk kaki sidebar. Offline perangkat mengalahkan status gateway. */
export function connectionView(connection: ConnectionState, online: boolean): ConnectionView {
  if (!online) return { label: copy.status.offline, tone: 'warning' };
  switch (connection.kind) {
    case 'connected':
      return { label: copy.status.connected, tone: 'success' };
    case 'connecting':
      return { label: copy.status.connecting, tone: 'warning' };
    case 'reconnecting':
      return { label: copy.status.reconnecting, tone: 'warning' };
    case 'idle':
      return { label: copy.status.idle, tone: 'muted' };
  }
}
