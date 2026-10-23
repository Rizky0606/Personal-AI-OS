import type { Channel, ServerEvent } from '@aios/contracts';

/** Event pada satu channel, siap dibungkus envelope WebSocket. */
export interface HubEvent {
  seq: number;
  /** ISO 8601 UTC. */
  ts: string;
  event: ServerEvent;
}

export type HubListener = (e: HubEvent) => void;

/**
 * Siaran in-process (satu gateway, satu VPS). Channel `run:*` membawa seq dari `run_events` sehingga bisa
 * diputar ulang; channel lain hanya live dan seq-nya penghitung di memori.
 */
export interface EventHub {
  subscribe(channel: Channel, listener: HubListener): () => void;
  /** Event yang sudah tersimpan di database (seq dan ts dari baris `run_events`). */
  publishStored(channel: Channel, e: HubEvent): void;
  /** Event tanpa log: seq dan ts diberikan hub. */
  publishLive(channel: Channel, event: ServerEvent): void;
}

export function createEventHub(now: () => number = Date.now): EventHub {
  const listeners = new Map<Channel, Set<HubListener>>();
  const liveSeq = new Map<Channel, number>();

  const deliver = (channel: Channel, e: HubEvent) => {
    for (const listener of [...(listeners.get(channel) ?? [])]) {
      try {
        listener(e);
      } catch {
        // Satu pelanggan yang error tidak boleh menghentikan siaran ke yang lain.
      }
    }
  };

  return {
    subscribe(channel, listener) {
      const set = listeners.get(channel) ?? new Set<HubListener>();
      set.add(listener);
      listeners.set(channel, set);
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(channel) === set) listeners.delete(channel);
      };
    },
    publishStored: deliver,
    publishLive(channel, event) {
      const seq = (liveSeq.get(channel) ?? 0) + 1;
      liveSeq.set(channel, seq);
      deliver(channel, { seq, ts: new Date(now()).toISOString(), event });
    },
  };
}
