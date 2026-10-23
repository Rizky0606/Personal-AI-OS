import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { ListItem } from '../ui/ListItem';
import { StateView, type ViewState } from '../ui/StateView';
import { useProjectRows } from './useProjectRows';

/** Daftar ringkas project di sidebar: nama dan branch bawaan. */
export function ProjectList() {
  const { rows, projects } = useProjectRows();
  const online = useOnline();
  const view: ViewState = projects.isPending
    ? 'loading'
    : projects.isError && !projects.data
      ? online
        ? 'error'
        : 'offline'
      : rows.length === 0
        ? 'empty'
        : 'content';
  return (
    <StateView
      state={view}
      loadingLabel={copy.projects.loading}
      emptyMessage={copy.projects.empty}
      errorMessage={projects.isError ? apiErrorMessage(projects.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void projects.refetch()}
    >
      <ul aria-label={copy.projects.listLabel}>
        {rows.map(({ project, binding }) => (
          <li key={project.id}>
            <ListItem
              title={project.name}
              supporting={binding ? project.defaultBranch : copy.projects.folderMissing}
            />
          </li>
        ))}
      </ul>
    </StateView>
  );
}
