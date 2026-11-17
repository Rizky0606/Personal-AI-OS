import type { UserEvent } from '@aios/contracts';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { devices, researchJobs, scheduleRuns, schedules } from '../../db/schema/index.js';
import { writeAudit } from '../audit/repo.js';
import type { EventHub } from '../runs/hub.js';
import type { FcmClient, PushMessage, PushResult } from './fcm.js';

export interface DevicePushResult {
  deviceId: string;
  name: string;
  result: PushResult;
}

export interface PushService {
  /** Mulai mendengarkan event channel `user` dan mengirim push yang relevan. */
  start(): void;
  /** Notifikasi uji ke satu perangkat Android (atau semuanya). Tidak ada isi selain judul. */
  sendTest(options?: { deviceId?: string; title?: string }): Promise<DevicePushResult[]>;
  /**
   * Usulan memori `pending` baru dari satu giliran chat (dipanggil MemoryProposalService sekali per ekstraksi).
   * Judul hanya jumlah usulan; data hanya ID. Tanpa FCM tidak melakukan apa pun.
   */
  memoryProposals(input: { conversationId: string; proposalIds: string[] }): void;
  /**
   * Memori yang disimpan otomatis dari satu giliran chat (mode `auto`, dipanggil sekali per ekstraksi).
   * Judul hanya jumlah memori; data hanya ID agar pemilik bisa langsung mengurungkannya.
   */
  memoryAutoSaved(input: { conversationId: string; proposalIds: string[] }): void;
  /**
   * Usulan agent baru (`task_propose`/`schedule_propose`). Usulan dari satu giliran digabung menjadi satu push:
   * ID yang datang dalam jendela AGENT_PROPOSAL_WINDOW_MS dengan kunci giliran yang sama dikirim bersama,
   * jadi satu run (maks 3 usulan) tidak pernah menghasilkan lebih dari satu notifikasi.
   * Judul hanya jumlah usulan; data hanya ID. Tanpa FCM tidak melakukan apa pun.
   */
  agentProposals(input: {
    /** Kunci giliran: run yang memanggil tool; null untuk Hermes yang bekerja tanpa run. */
    runId: string | null;
    conversationId: string | null;
    proposalId: string;
  }): void;
  /** Menunggu pengiriman yang sedang berjalan (tes, shutdown). */
  idle(): Promise<void>;
  close(): void;
}

const TITLE_MAX = 60;
/** Jendela penggabungan usulan agent satu giliran; cukup lama untuk tiga panggilan tool berurutan. */
const AGENT_PROPOSAL_WINDOW_MS = 5_000;
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/**
 * Push FCM ke perangkat Android yang punya `push_token`. Payload hanya judul dan ID: isi (jawaban, laporan)
 * diambil aplikasi lewat API setelah notifikasi dibuka, sehingga tidak ada isi percakapan yang lewat Google.
 */
export function createPushService(deps: {
  db: Database;
  hub: EventHub;
  /** Tanpa klien (FCM tidak dikonfigurasi) push dimatikan dan service tidak melakukan apa pun. */
  fcm: FcmClient | undefined;
  log?: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
}): PushService {
  const { db, hub, fcm, log } = deps;
  const pending = new Set<Promise<unknown>>();
  /** Usulan agent yang menunggu digabung, per giliran. */
  const agentBatches = new Map<
    string,
    { conversationId: string | null; ids: string[]; timer: NodeJS.Timeout }
  >();
  let unsubscribe: (() => void) | undefined;

  async function androidDevices(onlyId?: string) {
    return db
      .select({ id: devices.id, name: devices.name, pushToken: devices.pushToken })
      .from(devices)
      .where(
        and(
          eq(devices.kind, 'android'),
          isNull(devices.revokedAt),
          isNotNull(devices.pushToken),
          onlyId ? eq(devices.id, onlyId) : undefined,
        ),
      );
  }

  async function deliver(
    message: Omit<PushMessage, 'token'>,
    onlyId?: string,
  ): Promise<DevicePushResult[]> {
    if (!fcm) return [];
    const targets = await androidDevices(onlyId);
    return Promise.all(
      targets.map(async (device): Promise<DevicePushResult> => {
        const result = await fcm.send({ ...message, token: device.pushToken ?? '' });
        if (!result.ok) {
          // Token tidak pernah dicatat; hanya ID perangkat dan alasannya.
          log?.warn(
            { deviceId: device.id, reason: result.reason, status: result.status },
            'push FCM gagal',
          );
          if (result.reason === 'unregistered') {
            // Token mati: jangan dicoba lagi sampai aplikasi mendaftarkan token baru.
            await db.update(devices).set({ pushToken: null }).where(eq(devices.id, device.id));
            await writeAudit(db, {
              actorDeviceId: null,
              action: 'push.token_cleared',
              target: `device:${device.id}`,
            });
          }
        }
        return { deviceId: device.id, name: device.name, result };
      }),
    );
  }

  async function onScheduleResult(event: Extract<UserEvent, { type: 'schedule.result' }>) {
    if (event.status === 'missed' || event.status === 'running') return;
    // Jadwal "hanya bila berubah" yang hasilnya sama: tersimpan di riwayat, tanpa notifikasi.
    if (event.changed === false) return;
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, event.scheduleId));
    if (!schedule) return;
    const title =
      event.status === 'succeeded'
        ? clip(schedule.name, TITLE_MAX)
        : `${clip(schedule.name, TITLE_MAX - 8)} — gagal`;
    await deliver({
      title,
      data: {
        type: 'schedule.result',
        scheduleId: event.scheduleId,
        scheduleRunId: event.scheduleRunId,
        status: event.status,
        ...(event.runId ? { runId: event.runId } : {}),
        ...(schedule.conversationId ? { conversationId: schedule.conversationId } : {}),
      },
    });
  }

  async function onResearchCompleted(event: Extract<UserEvent, { type: 'research.completed' }>) {
    // Riset yang dijalankan jadwal sudah diberitahukan lewat schedule.result; jangan dobel.
    if (event.runId) {
      const [owner] = await db
        .select({ id: scheduleRuns.id })
        .from(scheduleRuns)
        .where(eq(scheduleRuns.runId, event.runId))
        .limit(1);
      if (owner) return;
    }
    const [job] = await db.select().from(researchJobs).where(eq(researchJobs.id, event.researchId));
    if (!job) return;
    await deliver({
      title: `Riset selesai: ${clip(job.question, TITLE_MAX)}`,
      data: {
        type: 'research.completed',
        researchId: event.researchId,
        ...(event.runId ? { runId: event.runId } : {}),
      },
    });
  }

  function track(work: Promise<unknown>) {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }

  /** Mengirim satu push untuk semua usulan agent yang terkumpul di satu giliran. */
  function flushAgentBatch(key: string) {
    const batch = agentBatches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    agentBatches.delete(key);
    track(
      deliver({
        title:
          batch.ids.length > 1 ? `${batch.ids.length} usulan agent baru` : 'Usulan agent baru',
        data: {
          type: 'agent_proposal',
          ...(batch.conversationId ? { conversationId: batch.conversationId } : {}),
          proposalIds: batch.ids.join(','),
        },
      }).catch((err: unknown) => log?.warn({ err }, 'push usulan agent gagal')),
    );
  }

  return {
    start() {
      if (!fcm) {
        log?.info({}, 'FCM tidak dikonfigurasi (FCM_SERVICE_ACCOUNT_FILE kosong): push dimatikan');
        return;
      }
      unsubscribe?.();
      unsubscribe = hub.subscribe('user', ({ event }) => {
        const ev = event as UserEvent;
        if (ev.type === 'schedule.result') {
          track(
            onScheduleResult(ev).catch((err: unknown) =>
              log?.warn({ err }, 'push schedule.result gagal'),
            ),
          );
        } else if (ev.type === 'notification' && ev.topic === 'skill_report') {
          // Laporan mingguan kurator skill (P11): hanya judul; ringkasannya dibaca di halaman Skill.
          track(
            deliver({ title: clip(ev.title, TITLE_MAX), data: { type: 'skills.report' } }).catch(
              (err: unknown) => log?.warn({ err }, 'push laporan skill gagal'),
            ),
          );
        } else if (ev.type === 'research.completed') {
          track(
            onResearchCompleted(ev).catch((err: unknown) =>
              log?.warn({ err }, 'push research.completed gagal'),
            ),
          );
        }
      });
    },

    sendTest(options = {}) {
      return deliver(
        { title: options.title ?? 'Tes notifikasi Personal AI OS', data: { type: 'test' } },
        options.deviceId,
      );
    },

    memoryProposals({ conversationId, proposalIds }) {
      if (!fcm || proposalIds.length === 0) return;
      track(
        deliver({
          title:
            proposalIds.length > 1
              ? `${proposalIds.length} usulan memori baru`
              : 'Usulan memori baru',
          data: { type: 'memory_proposal', conversationId, proposalIds: proposalIds.join(',') },
        }).catch((err: unknown) => log?.warn({ err }, 'push usulan memori gagal')),
      );
    },

    memoryAutoSaved({ conversationId, proposalIds }) {
      if (!fcm || proposalIds.length === 0) return;
      track(
        deliver({
          title:
            proposalIds.length > 1
              ? `${proposalIds.length} memori disimpan otomatis`
              : 'Memori disimpan otomatis',
          data: { type: 'memory_proposal', conversationId, proposalIds: proposalIds.join(',') },
        }).catch((err: unknown) => log?.warn({ err }, 'push memori otomatis gagal')),
      );
    },

    agentProposals({ runId, conversationId, proposalId }) {
      if (!fcm) return;
      // Hermes bekerja tanpa run dan tanpa percakapan: semua usulannya masuk satu kunci.
      const key = runId ?? conversationId ?? 'tanpa-run';
      const batch = agentBatches.get(key);
      if (batch) {
        batch.ids.push(proposalId);
        return;
      }
      const timer = setTimeout(() => flushAgentBatch(key), AGENT_PROPOSAL_WINDOW_MS);
      timer.unref();
      agentBatches.set(key, { conversationId, ids: [proposalId], timer });
    },

    async idle() {
      // Giliran yang masih menunggu jendela penggabungan dikirim sekarang agar tidak hilang.
      for (const key of [...agentBatches.keys()]) flushAgentBatch(key);
      await Promise.all([...pending]);
    },

    close() {
      for (const batch of agentBatches.values()) clearTimeout(batch.timer);
      agentBatches.clear();
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
