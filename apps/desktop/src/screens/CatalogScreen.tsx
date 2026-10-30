import { AgentOrb, type OrbState } from '../chat/AgentOrb';
import { RunActivity } from '../chat/RunActivity';
import type { Activity } from '../realtime/activity';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { copy } from '../copy';
import { Button, type ButtonVariant } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { ListItem } from '../ui/ListItem';
import { PageContainer } from '../ui/PageContainer';
import { SkeletonList } from '../ui/Skeleton';
import { StateView, type ViewState } from '../ui/StateView';
import { TextField } from '../ui/TextField';
import { useToastStore } from '../ui/Toaster';

const ORB_STATES: OrbState[] = ['idle', 'thinking', 'tool', 'writing', 'done', 'error'];

const phaseActivity = (phase: Activity['phase'], patch: Partial<Activity> = {}): Activity => ({
  headline: 'Memeriksa konfigurasi build',
  phase,
  current: null,
  stepCount: 1,
  hiddenCount: 0,
  elapsedMs: 12_000,
  steps: [{ id: 's1', label: 'Berkas dibaca', target: 'package.json', status: 'ok', durationMs: 340, startedAt: 0 }],
  summary: null,
  needsAttention: false,
  ...patch,
});

const RUN_PHASES: Activity[] = [
  phaseActivity('thinking', { stepCount: 0, steps: [] }),
  phaseActivity('tool', { current: { label: 'Menjalankan perintah', target: 'pnpm test', parallel: 1 } }),
  phaseActivity('writing'),
  phaseActivity('waiting_approval', { needsAttention: true }),
  phaseActivity('done', { summary: 'Selesai · 12 dtk · 1 langkah' }),
  phaseActivity('error', { summary: 'Gagal · 12 dtk · 1 langkah' }),
];

const TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'border-strong',
  'text',
  'text-2',
  'text-3',
  'accent',
  'accent-soft',
  'success',
  'warning',
  'danger',
  'info',
] as const;
const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const STATES: ViewState[] = ['loading', 'empty', 'error', 'offline', 'content'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-section font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

/** Katalog komponen untuk review visual (hanya mode dev): semua komponen dasar beserta state-nya. */
export function CatalogScreen() {
  const push = useToastStore((s) => s.push);
  const [view, setView] = useState<ViewState>('empty');
  const [text, setText] = useState('');
  return (
    <PageContainer>
      <Section title="Warna">
        <div className="grid grid-cols-7 gap-2">
          {TOKENS.map((token) => (
            <div key={token} className="flex flex-col gap-1">
              <div
                className="h-8 rounded-control border border-border"
                style={{ background: `var(--aios-${token})` }}
              />
              <span className="font-mono text-caption text-text-2">{token}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografi">
        <p className="text-page font-semibold">Judul halaman 20 px</p>
        <p className="text-section font-semibold">Judul bagian 16 px</p>
        <p className="max-w-[72ch] text-chat">
          Isi chat 14 px. Lebar baca dibatasi sekitar 72 karakter agar nyaman dibaca.
        </p>
        <p className="text-ui">UI default 13 px</p>
        <p className="text-meta text-text-2">Meta 12 px</p>
        <p className="text-caption text-text-3">Caption 11 px</p>
        <p className="font-mono text-ui">mono: src/app.ts +12 -3 · 1.234.567</p>
      </Section>

      <Section title="Tombol">
        <div className="flex flex-wrap gap-2">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          {VARIANTS.map((variant) => (
            <Button key={`${variant}-off`} variant={variant} disabled>
              {variant} nonaktif
            </Button>
          ))}
          <IconButton label="Tambah">
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
          <IconButton label="Tambah (aktif)" active>
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </div>
      </Section>

      <Section title="Field">
        <div className="grid max-w-md gap-4">
          <TextField
            label="Kosong dengan petunjuk"
            placeholder="ketik di sini"
            hint="Teks bantu"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <TextField
            label="Dengan error"
            error="Pesan error menyebut apa yang salah dan langkah berikutnya."
            defaultValue="isi yang salah"
          />
          <TextField label="Nonaktif" disabled defaultValue="terkunci" />
        </div>
      </Section>

      <Section title="Chip dan item daftar">
        <div className="flex gap-2">
          <Chip>general</Chip>
          <Chip selected>researcher</Chip>
        </div>
        <div className="max-w-md rounded-control border border-border">
          <ListItem
            title="Ringkasan berita AI"
            supporting="Setiap Senin 07.00 WIB"
            trailing="2 jam lalu"
            onClick={() => undefined}
          />
          <ListItem title="Item terpilih" selected onClick={() => undefined} />
          <ListItem title="Tanpa aksi" supporting="Baris statis" />
        </div>
      </Section>

      <Section title="Keadaan layar">
        <div className="flex gap-2">
          {STATES.map((s) => (
            <Chip key={s} selected={view === s} onClick={() => setView(s)}>
              {s}
            </Chip>
          ))}
        </div>
        <div className="max-w-md rounded-control border border-border">
          <StateView
            state={view}
            loadingLabel={copy.states.loading}
            emptyMessage="Belum ada jadwal. Tulis jadwal dalam kalimat biasa untuk memulai."
            emptyAction={<Button>Buat jadwal</Button>}
            errorMessage={copy.states.error}
            offlineMessage={copy.states.offline}
            retryLabel={copy.states.retry}
            onRetry={() => setView('loading')}
          >
            <p className="p-4 text-ui">Isi layar.</p>
          </StateView>
        </div>
      </Section>

      <Section title="Komponen keadaan">
        <SkeletonList rows={2} label={copy.states.loading} />
        <EmptyState
          message="Satu kalimat apa yang bisa dilakukan."
          action={<Button>Aksi</Button>}
        />
        <ErrorBanner
          message="Server tidak terjangkau. Periksa alamatnya dan pastikan server menyala."
          action={<Button>Coba lagi</Button>}
        />
        <ErrorBanner tone="warning" message="Offline. Tampilan memakai data terakhir." />
      </Section>

      <Section title="Aktivitas run">
        <div className="flex gap-3">
          {ORB_STATES.map((state) => (
            <AgentOrb key={state} state={state} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {RUN_PHASES.map((activity) => (
            <RunActivity key={activity.phase} activity={activity} now={0} />
          ))}
        </div>
      </Section>

      <Section title="Toast">
        <div className="flex gap-2">
          <Button onClick={() => push('Disalin ke papan klip')}>Toast biasa</Button>
          <Button onClick={() => push('Gagal menyimpan. Coba lagi.', 'danger')}>Toast error</Button>
        </div>
      </Section>
    </PageContainer>
  );
}
