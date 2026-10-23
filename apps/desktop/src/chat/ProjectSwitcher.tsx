import { useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { RadioMenu } from '../ui/RadioMenu';
import { useProjects } from '../worker/hooks';

const GENERAL = '__umum__';

/**
 * Memilih konteks chat di sidebar: chat umum, atau satu project (percakapan terikat project dan dikerjakan
 * agent coding di PC ini). Berganti konteks membuka chat baru di konteks itu.
 */
export function ProjectSwitcher() {
  const projects = useProjects();
  const activeId = useUiStore((s) => s.activeProjectId);
  const setActive = useUiStore((s) => s.setActiveProject);
  const navigate = useNavigate();
  const list = projects.data ?? [];
  const current = list.find((p) => p.id === activeId);
  // Project yang dipilih tapi sudah tidak ada di server: kembali ke chat umum.
  const value = current ? current.id : GENERAL;

  return (
    <div className="flex flex-col gap-1 border-b border-border p-2">
      <span className="text-caption text-text-3">{copy.projectSwitcher.label}</span>
      <RadioMenu
        label={copy.projectSwitcher.pick}
        value={value}
        onValueChange={(next) => {
          setActive(next === GENERAL ? null : next);
          void navigate({ to: '/' });
        }}
        options={[
          { value: GENERAL, label: copy.projectSwitcher.general },
          ...list.map((p) => ({ value: p.id, label: p.name })),
        ]}
        trigger={
          <button
            type="button"
            aria-label={`${copy.projectSwitcher.label}: ${current?.name ?? copy.projectSwitcher.general}`}
            className="flex h-8 w-full items-center justify-between gap-2 rounded-control border border-border bg-surface px-2 text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
          >
            <span className="truncate">{current?.name ?? copy.projectSwitcher.general}</span>
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
              className="shrink-0 text-text-2"
            />
          </button>
        }
      />
      {list.length === 0 && !projects.isPending ? (
        <p className="text-caption text-text-3">{copy.projectSwitcher.none}</p>
      ) : null}
    </div>
  );
}
