import type { Project, ProjectBinding } from '@aios/contracts';
import { FolderGit2, GitBranch, MoreHorizontal } from 'lucide-react';
import type { WorkspaceRun } from '../workspace/runs';
import { copy } from '../copy';
import { enterDelay } from '../screens/PageLayout';
import { ActionMenu, type MenuAction } from '../ui/ActionMenu';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { StackChips } from './StackChips';
import { LastActivity } from './LastActivity';

export interface ProjectRowProps {
  project: Project;
  binding: ProjectBinding | undefined;
  mine: boolean;
  workerReady: boolean;
  index: number;
  onBind: () => void;
  onChangeBranch: () => void;
  onEditSetup: () => void;
  onEditRules: () => void;
  onOpenChat: () => void;
  latest: WorkspaceRun | undefined;
  onUnbind: () => void;
  onRemove: () => void;
}

export function ProjectRow({
  project,
  binding,
  mine,
  workerReady,
  index,
  onBind,
  onChangeBranch,
  onEditSetup,
  onEditRules,
  onUnbind,
  onRemove,
  onOpenChat,
  latest,
}: ProjectRowProps) {
  const c = copy.projects;
  const actions: MenuAction[] = [
    { id: 'branch', label: c.menu.branch, onSelect: onChangeBranch },
    ...(workerReady && mine ? [{ id: 'setup', label: c.setup.edit, onSelect: onEditSetup }] : []),
    { id: 'rules', label: c.rules.edit, onSelect: onEditRules },
    ...(binding && workerReady
      ? [{ id: 'unbind', label: c.unbind.action, onSelect: onUnbind }]
      : []),
    { id: 'remove', label: c.remove.action, danger: true, onSelect: onRemove },
  ];
  return (
    <tr
      style={enterDelay(index)}
      className="animate-aios-enter border-b border-border hover:bg-surface-2"
    >
      <th scope="row" className="px-5 py-4 text-left font-normal">
        <li className="list-none">
          <div className="flex items-start gap-4">
            <FolderGit2
              size={16}
              strokeWidth={1.5}
              aria-hidden="true"
              className="mt-1 shrink-0 text-text-3"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-chat font-medium text-text">{project.name}</span>
                <span className="inline-flex items-center gap-1 font-mono text-meta text-text-2">
                  <GitBranch size={12} strokeWidth={1.5} aria-hidden="true" />
                  {project.defaultBranch}
                </span>
              </div>
              <StackChips stack={project.stack} />
              {binding ? (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-meta break-all text-text" title={binding.path}>
                    {binding.path}
                  </span>
                  {binding.available ? null : (
                    <span className="text-meta text-warning">{c.folderUnavailable}</span>
                  )}
                </div>
              ) : mine ? (
                <span className="text-meta text-text-2">{c.unbound}</span>
              ) : (
                <span className="text-meta text-text-3">{c.folderMissing}</span>
              )}
              {project.instructions ? (
                <p className="flex gap-2 text-meta text-text-2">
                  <span className="shrink-0 text-text-3">{c.columns.rules}</span>
                  <span className="line-clamp-2 min-w-0 whitespace-pre-wrap">
                    {project.instructions}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
        </li>
      </th>
      <td className="px-5 py-4">
        <LastActivity entry={latest} />
      </td>
      <td className="px-5 py-4">
        <Button
          variant="secondary"
          aria-label={`${c.openChat}: ${project.name}`}
          onClick={onOpenChat}
        >
          {c.openChat}
        </Button>
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-1">
          {!binding && mine ? (
            <Button
              variant="secondary"
              disabled={!workerReady}
              aria-label={`${c.bindFolder}: ${project.name}`}
              onClick={onBind}
            >
              {c.bindFolder}
            </Button>
          ) : null}
          <ActionMenu
            trigger={
              <IconButton label={c.rowMenu(project.name)}>
                <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            }
            actions={actions}
          />
        </div>
      </td>
    </tr>
  );
}
