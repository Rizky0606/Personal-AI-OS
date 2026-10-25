import { useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useConversations } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { StateView, type ViewState } from '../ui/StateView';
import { ConversationRow } from './ConversationRow';
import { useConversationActions } from './useConversationActions';

/** Daftar percakapan di sidebar: yang disematkan di atas, lalu menurut urutan server (terbaru dulu). */
export function ConversationList() {
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const query = useConversations(activeProjectId);
  const online = useOnline();
  const params = useParams({ strict: false });
  const activeId = params.conversationId;
  const actions = useConversationActions(activeId);

  const items = useMemo(() => {
    // Server mengembalikan semua percakapan bila tanpa project; chat umum menyaring yang tidak terikat project.
    const all = (query.data?.pages.flatMap((page) => page.items) ?? []).filter((c) =>
      activeProjectId === null ? c.projectId === null : c.projectId === activeProjectId,
    );
    return [...all.filter((c) => c.pinned), ...all.filter((c) => !c.pinned)];
  }, [query.data, activeProjectId]);

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && items.length === 0
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  return (
    <StateView
      state={view}
      loadingLabel={copy.chat.listLoading}
      emptyMessage={copy.chat.listEmpty}
      errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
      offlineMessage={copy.states.offline}
      retryLabel={copy.states.retry}
      onRetry={() => void query.refetch()}
    >
      <nav aria-label={copy.chat.listLabel}>
        {items.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === activeId}
            onRename={(title) => void actions.rename(conversation.id, title)}
            onPin={(pinned) => void actions.setPinned(conversation.id, pinned)}
            onArchive={() => void actions.archive(conversation.id)}
            onDelete={() => void actions.remove(conversation.id)}
          />
        ))}
        {query.hasNextPage ? (
          <div className="p-2">
            <Button
              variant="ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {copy.chat.loadMore}
            </Button>
          </div>
        ) : null}
      </nav>
    </StateView>
  );
}
