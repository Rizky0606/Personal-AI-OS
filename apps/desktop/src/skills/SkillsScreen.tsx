import * as Tabs from '@radix-ui/react-tabs';
import { useState } from 'react';
import { copy } from '../copy';
import { Page, PageHeader } from '../screens/PageLayout';
import { useSkillProposals } from '../api/queries';
import { useUiStore } from '../state/uiStore';
import { HermesTab } from './HermesTab';
import { InstallTab } from './InstallTab';
import { MySkillsTab } from './MySkillsTab';
import { ProposalsTab } from './ProposalsTab';

const t = copy.skillsPage;
type Tab = 'mine' | 'install' | 'proposals' | 'hermes';
const TABS: Tab[] = ['mine', 'install', 'proposals', 'hermes'];

/** Halaman Skill (P10): skill saya, pasang dari luar, dan skill Hermes (hanya baca). */
export function SkillsScreen() {
  // Dibuka dari kartu usulan di jawaban atau panel Progres: langsung ke tab Usulan agent.
  const [tab, setTab] = useState<Tab>(() =>
    useUiStore.getState().skillsFocus ? 'proposals' : 'mine',
  );
  const pending = useSkillProposals({ status: 'pending' }).data?.length ?? 0;
  return (
    <Page width="lg">
      <PageHeader title={t.title} description={t.summary} />
      <Tabs.Root
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="flex flex-col gap-4"
      >
        <Tabs.List
          aria-label={t.title}
          className="flex w-fit items-center gap-0.5 rounded-full bg-surface-2 p-1"
        >
          {TABS.map((id) => (
            <Tabs.Trigger
              key={id}
              value={id}
              className="inline-flex h-7 items-center rounded-full border border-transparent px-3 text-ui text-text-2 data-[state=active]:border-border data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              {id === 'proposals' ? t.proposalsTab(pending) : t.tabs[id]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="mine">
          <MySkillsTab />
        </Tabs.Content>
        <Tabs.Content value="install">
          <InstallTab />
        </Tabs.Content>
        <Tabs.Content value="proposals">
          <ProposalsTab />
        </Tabs.Content>
        <Tabs.Content value="hermes">
          <HermesTab />
        </Tabs.Content>
      </Tabs.Root>
    </Page>
  );
}
