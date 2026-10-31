import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useAuthState } from '../app/hooks';
import { auth } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { MemorySection } from '../memory/MemorySection';
import { useUiStore } from '../state/uiStore';
import { TemplatesSection } from '../templates/TemplatesSection';
import { Button } from '../ui/Button';
import { enterProps } from '../ui/enter';
import { ListItem } from '../ui/ListItem';
import { PageContainer } from '../ui/PageContainer';
import { PageHeader } from '../ui/PageHeader';
import { Switch } from '../ui/Switch';
import { UpdateSection } from '../updater/UpdateSection';
import { AllowedFolders } from '../worker/AllowedFolders';
import { AppearanceSettings } from './AppearanceSettings';
import { ModelSettings } from './ModelSettings';

const linkClass = 'text-ui text-text underline underline-offset-2';

/** Satu kelompok pengaturan: judul h2 dan isi; masuk bergantian menurut urutan. */
function Group({
  id,
  title,
  index,
  children,
}: {
  id: string;
  title: string;
  index: number;
  children: ReactNode;
}) {
  const enter = enterProps(index);
  return (
    <section
      aria-labelledby={id}
      style={enter.style}
      className={cn('flex flex-col gap-3', enter.className)}
    >
      <h2 id={id} className="text-section font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Pengaturan dalam enam kelompok: Akun, Koneksi, Model, Tampilan, Notifikasi, Lanjutan. */
export function SettingsScreen() {
  const state = useAuthState();
  const inAppToasts = useUiStore((s) => s.inAppToasts);
  const setInAppToasts = useUiStore((s) => s.setInAppToasts);
  const [loggingOut, setLoggingOut] = useState(false);
  const session = state.status === 'signedIn' ? state.session : null;
  const g = copy.settings.groups;

  async function logout() {
    setLoggingOut(true);
    try {
      await auth.logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title={copy.settings.title} />
      <PageContainer>
        <Group id="settings-account" title={g.account} index={0}>
          <div className="flex flex-col">
            <ListItem title={copy.settings.device} trailing={session?.deviceName ?? ''} />
          </div>
          <div>
            <Button variant="danger" disabled={loggingOut} onClick={() => void logout()}>
              {loggingOut ? copy.settings.loggingOut : copy.settings.logout}
            </Button>
          </div>
        </Group>

        <Group id="settings-connection" title={g.connection} index={1}>
          <div className="flex flex-col">
            <ListItem title={copy.settings.server} trailing={session?.serverUrl ?? ''} />
          </div>
          <div className="flex gap-3">
            <Link to="/status" className={linkClass}>
              {copy.status.page.title}
            </Link>
            <Link to="/quota" className={linkClass}>
              {copy.quota.title}
            </Link>
          </div>
        </Group>

        <Group id="settings-model" title={g.model} index={2}>
          <ModelSettings />
        </Group>

        <Group id="settings-appearance" title={g.appearance} index={3}>
          <AppearanceSettings />
        </Group>

        <Group id="settings-notifications" title={g.notifications} index={4}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-ui text-text">{copy.settings.inAppToasts}</span>
              <span className="text-meta text-text-2">{copy.settings.inAppToastsHint}</span>
            </div>
            <Switch
              label={copy.settings.inAppToasts}
              checked={inAppToasts}
              onChange={setInAppToasts}
            />
          </div>
        </Group>

        <Group id="settings-advanced" title={g.advanced} index={5}>
          <MemorySection />
          <TemplatesSection />
          <AllowedFolders />
          <section aria-labelledby="settings-tools" className="flex flex-col gap-2">
            <h3 id="settings-tools" className="text-ui font-semibold text-text">
              {copy.settings.tools}
            </h3>
            <div className="flex gap-3">
              <Link to="/compare" className={linkClass}>
                {copy.compare.title}
              </Link>
            </div>
          </section>
          <section aria-labelledby="settings-shortcuts" className="flex flex-col gap-2">
            <h3 id="settings-shortcuts" className="text-ui font-semibold text-text">
              {copy.settings.shortcuts}
            </h3>
            <ul className="flex flex-col gap-1 font-mono text-meta text-text-2">
              <li>{copy.shortcuts.palette}</li>
              <li>{copy.shortcuts.newChat}</li>
              <li>{copy.shortcuts.sidebar}</li>
              <li>{copy.shortcuts.rightPanel}</li>
              <li>{copy.shortcuts.navigate}</li>
              <li>{copy.shortcuts.quickAsk}</li>
            </ul>
          </section>
          <UpdateSection />
        </Group>
      </PageContainer>
    </div>
  );
}
