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
import { UpdateSection } from '../updater/UpdateSection';
import { AllowedFolders } from '../worker/AllowedFolders';
import { Page, PageHeader, Section } from './PageLayout';

const themes: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: copy.settings.themeSystem },
  { value: 'light', label: copy.settings.themeLight },
  { value: 'dark', label: copy.settings.themeDark },
];

const shortcuts = [
  copy.shortcuts.palette,
  copy.shortcuts.newChat,
  copy.shortcuts.sidebar,
  copy.shortcuts.rightPanel,
  copy.shortcuts.quickAsk,
];

/** Pengaturan dalam bagian bergaris: akun dan perangkat, alat, tampilan, memori, templat, folder, pembaruan, pintasan. */
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
    <Page width="md" className="animate-aios-enter">
      <PageHeader title={copy.settings.title} description={copy.settings.description} />

      <Section
        id="settings-account"
        title={copy.settings.account}
        description={copy.settings.accountHint}
        actions={
          <Button variant="danger" disabled={loggingOut} onClick={() => void logout()}>
            {loggingOut ? copy.settings.loggingOut : copy.settings.logout}
          </Button>
        }
      >
        <dl className="divide-y divide-border rounded-panel border border-border bg-surface">
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-ui">
            <dt className="text-text-2">{copy.settings.server}</dt>
            <dd className="min-w-0 truncate font-mono text-meta text-text">
              {session?.serverUrl ?? ''}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-ui">
            <dt className="text-text-2">{copy.settings.device}</dt>
            <dd className="min-w-0 truncate text-text">{session?.deviceName ?? ''}</dd>
          </div>
        </dl>
      </Section>

      <Section
        id="settings-theme"
        title={copy.settings.appearance}
        description={copy.settings.appearanceHint}
      >
        <div role="group" aria-label={copy.settings.theme} className="flex flex-wrap gap-2">
          {themes.map((t) => (
            <Chip key={t.value} selected={theme === t.value} onClick={() => setTheme(t.value)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </Section>

      <div className="border-t border-border pt-6">
        <MemorySection />
      </div>

      <div className="border-t border-border pt-6">
        <TemplatesSection />
      </div>

      <div className="border-t border-border pt-6">
        <AllowedFolders />
      </div>

      <Section
        id="settings-tools"
        title={copy.settings.tools}
        description={copy.settings.toolsHint}
      >
        <nav aria-label={copy.settings.tools} className="flex flex-wrap gap-2">
          <ToolLink to="/status" label={copy.status.page.title} />
          <ToolLink to="/quota" label={copy.quota.title} />
          <ToolLink to="/compare" label={copy.compare.title} />
        </nav>
      </Section>

      <div className="border-t border-border pt-6">
        <UpdateSection />
      </div>

      <Section
        id="settings-shortcuts"
        title={copy.settings.shortcuts}
        description={copy.settings.shortcutsHint}
      >
        <ul className="divide-y divide-border rounded-panel border border-border bg-surface font-mono text-meta text-text-2">
          {shortcuts.map((line) => (
            <li key={line} className="px-4 py-2 whitespace-pre">
              {line}
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}

function ToolLink({ to, label }: { to: '/status' | '/quota' | '/compare'; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-ui font-medium text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
    >
      {label}
    </Link>
  );
}
