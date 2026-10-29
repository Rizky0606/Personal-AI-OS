import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthState } from '../app/hooks';
import { auth } from '../app/services';
import { copy } from '../copy';
import { useUiStore, type ThemeMode } from '../state/uiStore';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { MemorySection } from '../memory/MemorySection';
import { TemplatesSection } from '../templates/TemplatesSection';
import { ListItem } from '../ui/ListItem';
import { UpdateSection } from '../updater/UpdateSection';
import { AllowedFolders } from '../worker/AllowedFolders';

const themes: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: copy.settings.themeSystem },
  { value: 'light', label: copy.settings.themeLight },
  { value: 'dark', label: copy.settings.themeDark },
];

/** Info perangkat, tema, shortcut, dan keluar. */
export function SettingsScreen() {
  const state = useAuthState();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [loggingOut, setLoggingOut] = useState(false);
  const session = state.status === 'signedIn' ? state.session : null;

  async function logout() {
    setLoggingOut(true);
    try {
      await auth.logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6 p-4">
      <section aria-labelledby="settings-account" className="flex flex-col">
        <h2 id="settings-account" className="mb-2 text-section font-semibold text-text">
          {copy.settings.account}
        </h2>
        <ListItem title={copy.settings.server} trailing={session?.serverUrl ?? ''} />
        <ListItem title={copy.settings.device} trailing={session?.deviceName ?? ''} />
      </section>

      <MemorySection />

      <TemplatesSection />

      <AllowedFolders />

      <section aria-labelledby="settings-tools" className="flex flex-col gap-2">
        <h2 id="settings-tools" className="text-section font-semibold text-text">
          {copy.settings.tools}
        </h2>
        <div className="flex gap-2">
          <Link to="/status" className="text-ui text-text underline underline-offset-2">
            {copy.status.page.title}
          </Link>
          <Link to="/quota" className="text-ui text-text underline underline-offset-2">
            {copy.quota.title}
          </Link>
          <Link to="/compare" className="text-ui text-text underline underline-offset-2">
            {copy.compare.title}
          </Link>
        </div>
      </section>

      <section aria-labelledby="settings-theme" className="flex flex-col gap-2">
        <h2 id="settings-theme" className="text-section font-semibold text-text">
          {copy.settings.theme}
        </h2>
        <div className="flex gap-2">
          {themes.map((t) => (
            <Chip key={t.value} selected={theme === t.value} onClick={() => setTheme(t.value)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </section>

      <section aria-labelledby="settings-shortcuts" className="flex flex-col gap-2">
        <h2 id="settings-shortcuts" className="text-section font-semibold text-text">
          {copy.settings.shortcuts}
        </h2>
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

      <div>
        <Button variant="danger" disabled={loggingOut} onClick={() => void logout()}>
          {loggingOut ? copy.settings.loggingOut : copy.settings.logout}
        </Button>
      </div>
    </div>
  );
}
