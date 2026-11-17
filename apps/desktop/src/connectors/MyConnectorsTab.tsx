import type { McpConnector } from '@aios/contracts';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useMcpConnectors } from '../api/queries';
import { api } from '../app/services';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StateView, type ViewState } from '../ui/StateView';
import { Switch } from '../ui/Switch';
import { useConnectorActions } from './useConnectorActions';

const t = copy.connectorsPage.mine;

/** Host saja (tanpa skema dan path) supaya baris tetap pendek; URL tak sah ditampilkan apa adanya. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Daftar konektor terdaftar: nyala/mati, periksa ulang, dan hapus. */
export function MyConnectorsTab({ onAdd }: { onAdd: () => void }) {
  const { busy, run, online, push } = useConnectorActions();
  const list = useMcpConnectors();
  const [removing, setRemoving] = useState<McpConnector | null>(null);

  const items = list.data ?? [];
  const state: ViewState = list.isPending
    ? online
      ? 'loading'
      : 'offline'
    : list.isError
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-ui text-text-2">{t.intro}</p>

      <StateView
        state={state}
        loadingLabel={t.loading}
        emptyMessage={t.empty}
        errorMessage={apiErrorMessage(list.error, online)}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void list.refetch()}
        emptyAction={
          <Button variant="primary" disabled={!online} onClick={onAdd}>
            {t.addAction}
          </Button>
        }
      >
        <ul
          aria-label={t.listLabel}
          className="flex flex-col rounded-panel border border-border bg-surface"
        >
          {items.map((connector) => {
            const read = connector.tools.filter((tool) => tool.readOnly).length;
            return (
              <li
                key={connector.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-ui font-medium text-text">
                    {connector.displayName}
                  </span>
                  <span className="flex flex-wrap gap-x-2 text-caption text-text-3">
                    <span>{t.slug(connector.name)}</span>
                    <span>{t.host(hostOf(connector.url))}</span>
                    <span>{t.toolCount(connector.tools.length)}</span>
                    <span>{t.readWrite(read, connector.tools.length - read)}</span>
                  </span>
                  {connector.lastError ? (
                    <span className="text-caption text-danger">
                      {t.lastError(connector.lastError)}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  disabled={!online || busy !== null}
                  onClick={() =>
                    void run(`probe:${connector.id}`, async () => {
                      const probe = await api.reprobeMcpConnector(connector.id);
                      push(t.reprobed(probe.tools.length));
                      return probe;
                    })
                  }
                >
                  {busy === `probe:${connector.id}` ? t.reprobing : t.reprobe}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!online || busy !== null}
                  onClick={() => setRemoving(connector)}
                >
                  {t.delete}
                </Button>
                <Switch
                  label={t.toggle(connector.displayName)}
                  checked={connector.enabled}
                  disabled={!online || busy !== null}
                  onChange={(on) =>
                    void run(
                      `enable:${connector.id}`,
                      () => api.setMcpConnectorEnabled(connector.id, on),
                      on ? t.enabled : t.disabled,
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </StateView>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t.deleteTitle}
        body={t.deleteBody}
        confirmLabel={t.deleteConfirm}
        cancelLabel={t.cancel}
        destructive
        busy={busy?.startsWith('delete:') ?? false}
        onConfirm={() => {
          const target = removing;
          if (!target) return;
          setRemoving(null);
          void run(`delete:${target.id}`, () => api.deleteMcpConnector(target.id), t.deleted);
        }}
      />
    </div>
  );
}
