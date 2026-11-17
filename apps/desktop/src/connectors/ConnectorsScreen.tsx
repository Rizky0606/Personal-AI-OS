import * as Tabs from '@radix-ui/react-tabs';
import { useState } from 'react';
import { copy } from '../copy';
import { Page, PageHeader } from '../screens/PageLayout';
import { AddConnectorTab } from './AddConnectorTab';
import { MyConnectorsTab } from './MyConnectorsTab';

const t = copy.connectorsPage;
type Tab = 'mine' | 'add';
const TABS: Tab[] = ['mine', 'add'];

/** Halaman Konektor: daftar server MCP pihak ketiga dan pendaftaran konektor baru. */
export function ConnectorsScreen() {
  const [tab, setTab] = useState<Tab>('mine');
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
              {t.tabs[id]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="mine">
          <MyConnectorsTab onAdd={() => setTab('add')} />
        </Tabs.Content>
        <Tabs.Content value="add">
          <AddConnectorTab />
        </Tabs.Content>
      </Tabs.Root>
    </Page>
  );
}
