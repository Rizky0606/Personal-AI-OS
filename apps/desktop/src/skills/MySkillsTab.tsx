import type { SkillSource, SkillSummary } from '@aios/contracts';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { apiErrorMessage } from '../api/errors';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { StateView, type ViewState } from '../ui/StateView';
import { Switch } from '../ui/Switch';
import { SkillEditor } from './SkillEditor';
import { useSkillActions } from './useSkillActions';

const t = copy.skillsPage;
type Filter = 'all' | SkillSource;
const FILTERS: Filter[] = ['all', 'builtin', 'user', 'installed', 'agent'];

/** Daftar seluruh katalog (aktif, nonaktif, arsip) dengan sakelar aktif dan penyuntingan. */
export function MySkillsTab() {
  const online = useOnline();
  const { busy, run } = useSkillActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<SkillSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['skills', 'list'], queryFn: () => api.listSkills() });

  const all = list.data ?? [];
  const items = filter === 'all' ? all : all.filter((s) => s.source === filter);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={t.listLabel} className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? t.filterAll : t.sources[f]}
            </Chip>
          ))}
        </div>
        <Button variant="primary" disabled={!online} onClick={() => setCreating(true)}>
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          {t.newSkill}
        </Button>
      </div>

      <StateView
        state={state}
        loadingLabel={t.loading}
        emptyMessage={t.empty}
        errorMessage={apiErrorMessage(list.error, online)}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void list.refetch()}
        emptyAction={
          <Button variant="primary" disabled={!online} onClick={() => setCreating(true)}>
            {t.newSkill}
          </Button>
        }
      >
        <ul
          aria-label={t.listLabel}
          className="flex flex-col rounded-panel border border-border bg-surface"
        >
          {items.map((skill) => {
            const status = skill.status ?? 'active';
            return (
              <li
                key={skill.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setEditing(skill)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                >
                  <span className="truncate text-ui font-medium text-text">{skill.name}</span>
                  <span className="truncate text-meta text-text-2">{skill.description}</span>
                  <span className="flex flex-wrap gap-x-2 text-caption text-text-3">
                    <span>{t.sources[skill.source]}</span>
                    {skill.trust ? <span>{t.trust[skill.trust]}</span> : null}
                    <span>{t.version(skill.version)}</span>
                    {skill.pinned ? <span>{t.pinnedBadge}</span> : null}
                    {status !== 'active' ? <span>{t.status[status]}</span> : null}
                  </span>
                </button>
                <Switch
                  label={t.toggle(skill.name)}
                  checked={status === 'active'}
                  disabled={!online || busy !== null}
                  onChange={(on) =>
                    void run(
                      `status:${skill.id}`,
                      () => api.setSkillStatus(skill.id, on ? 'active' : 'disabled'),
                      copy.skillsPage.editor.statusChanged,
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </StateView>

      <SkillEditor
        skill={editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
