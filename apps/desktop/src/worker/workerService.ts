import type { LocalPush } from '@aios/contracts';
import type { WorkerRegistration } from '../api/gateway';
import type { AuthState } from '../auth/authSession';
import type { WorkerSnapshot } from './localClient';
import type { WorkerVault } from './workerVault';

export interface WorkerServiceDeps {
  client: {
    getSnapshot(): WorkerSnapshot;
    subscribe(listener: () => void): () => void;
    call(method: string, params?: object): Promise<unknown>;
    onPush(listener: (push: LocalPush) => void): () => void;
  };
  auth: { getState(): AuthState; subscribe(listener: () => void): () => void };
  vault: WorkerVault;
  /** `POST /devices/worker` dengan sesi desktop. */
  register: (name: string) => Promise<WorkerRegistration>;
  /** Jarak minimum antar pendaftaran/percobaan ulang saat gagal, supaya tidak berputar cepat. */
  retryMs?: number;
}

/**
 * Menghubungkan worker lokal ke gateway: mendaftarkan perangkat worker otomatis (tanpa langkah manual),
 * menyimpan kredensialnya di Credential Manager, dan memberikannya ke worker tiap kali worker (baru) tersambung.
 */
export class WorkerService {
  private unsubscribers: (() => void)[] = [];
  private busy = false;
  private signedIn = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: WorkerServiceDeps) {}

  start(): void {
    if (this.unsubscribers.length > 0) return;
    this.signedIn = this.deps.auth.getState().status === 'signedIn';
    this.unsubscribers = [
      this.deps.auth.subscribe(() => void this.onAuth()),
      this.deps.client.subscribe(() => void this.ensure()),
      this.deps.client.onPush((push) => void this.onPush(push)),
    ];
    void this.ensure();
  }

  stop(): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    clearTimeout(this.retryTimer);
  }

  private async onAuth(): Promise<void> {
    const signedIn = this.deps.auth.getState().status === 'signedIn';
    const wasSignedIn = this.signedIn;
    this.signedIn = signedIn;
    if (wasSignedIn && !signedIn) {
      // Keluar dari akun: worker berhenti memakai kredensial dan kredensialnya dihapus dari perangkat.
      await this.deps.client.call('session.clear').catch(() => undefined);
      await this.deps.vault.clear();
      return;
    }
    if (signedIn) await this.ensure();
  }

  /** Worker tersambung tetapi belum punya sesi gateway: berikan (daftarkan dulu bila belum pernah). */
  private async ensure(): Promise<void> {
    const auth = this.deps.auth.getState();
    const snapshot = this.deps.client.getSnapshot();
    if (auth.status !== 'signedIn' || snapshot.local !== 'connected' || snapshot.status === null)
      return;
    if (snapshot.status.deviceId !== null || this.busy) return;

    this.busy = true;
    try {
      let record = await this.deps.vault.load();
      if (record && record.serverUrl !== auth.session.serverUrl) {
        // Server berganti: kredensial lama milik server lain.
        record = null;
        await this.deps.vault.clear();
      }
      if (!record) {
        const registered = await this.deps.register(`${auth.session.deviceName} worker`);
        record = {
          serverUrl: auth.session.serverUrl,
          deviceId: registered.device.id,
          accessToken: registered.accessToken,
          refreshToken: registered.refreshToken,
        };
        await this.deps.vault.save(record);
      }
      await this.deps.client.call('session.set', record);
    } catch {
      this.scheduleRetry();
    } finally {
      this.busy = false;
    }
  }

  private async onPush(push: LocalPush): Promise<void> {
    if (push.push === 'session.updated') {
      const record = await this.deps.vault.load();
      // Refresh token dirotasi: tanpa menyimpan yang baru, start berikutnya memakai token yang sudah mati.
      if (record) {
        await this.deps.vault
          .save({ ...record, accessToken: push.accessToken, refreshToken: push.refreshToken })
          .catch(() => undefined);
      }
    } else if (push.push === 'session.invalid') {
      // Perangkat worker dicabut atau tokennya terpakai ulang: buang dan daftarkan yang baru.
      await this.deps.vault.clear();
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.ensure(), this.deps.retryMs ?? 60_000);
  }
}
