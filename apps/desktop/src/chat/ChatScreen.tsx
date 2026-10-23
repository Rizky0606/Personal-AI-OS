import { apiErrorMessage } from '../api/errors';
import { copy } from '../copy';
import { ErrorBanner } from '../ui/ErrorBanner';
import { StateView, type ViewState } from '../ui/StateView';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { ReviewBanner } from './ReviewBanner';
import { useChatController } from './useChatController';

function ChatView({ conversationId }: { conversationId: string | undefined }) {
  const chat = useChatController(conversationId);
  const { status } = chat;

  const hasContent = chat.messages.length > 0 || chat.pending !== null || chat.live !== undefined;
  const view: ViewState =
    conversationId === undefined
      ? 'empty'
      : status.isPending
        ? 'loading'
        : status.isError && !hasContent
          ? chat.online
            ? 'error'
            : 'offline'
          : hasContent
            ? 'content'
            : 'empty';

  return (
    <div className="flex h-full flex-col">
      {chat.online ? null : (
        <ErrorBanner tone="warning" message={copy.states.offline} className="m-3 mb-0" />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <StateView
          state={view}
          loadingLabel={copy.chat.loadingMessages}
          emptyMessage={copy.chat.emptyThread}
          errorMessage={status.isError ? apiErrorMessage(status.error, chat.online) : ''}
          offlineMessage={copy.states.offline}
          retryLabel={copy.states.retry}
          onRetry={() => void status.refetch()}
        >
          <MessageList
            messages={chat.messages}
            roles={chat.roles}
            pending={chat.pending}
            live={chat.live}
            failure={chat.failure}
            rerunnableId={chat.rerunnableId}
            onReroute={chat.reroute}
            approvals={chat.approvals}
            resolvingApprovals={chat.resolvingApprovals}
            onResolveApproval={chat.resolveApproval}
            hasMore={chat.hasMore}
            loadingOlder={chat.loadingOlder}
            onLoadOlder={chat.loadOlder}
          />
        </StateView>
      </div>
      {chat.reviewRunId ? <ReviewBanner runId={chat.reviewRunId} /> : null}
      <Composer
        draft={chat.draft}
        onDraft={chat.setDraft}
        onSend={chat.send}
        onStop={chat.stop}
        streaming={chat.streaming}
        sending={chat.sending}
        roles={chat.roles}
        role={chat.role}
        onRole={chat.setRole}
        models={chat.models}
        model={chat.model}
        onModel={chat.setModel}
        canEditLast={chat.canEditLast}
        onEditLast={chat.editLast}
        focusNonce={chat.focusNonce}
        suggestions={view === 'empty' ? copy.chat.suggestions : undefined}
      />
    </div>
  );
}

/** Layar chat umum. Dikunci per percakapan supaya isian dan pilihan tidak bocor antar percakapan. */
export function ChatScreen({ conversationId }: { conversationId?: string }) {
  return <ChatView key={conversationId ?? 'new'} conversationId={conversationId} />;
}
