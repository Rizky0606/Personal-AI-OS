import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { apiErrorMessage } from '../api/errors';
import { usePromptTemplates } from '../api/queries';
import { useTemplateInsert } from '../templates/useTemplateInsert';
import { activitySteps } from '../activity/steps';
import type { Message } from '@aios/contracts';
import { buildActivity, type SavedTool } from '../realtime/activity';
import { useNow } from '../app/useNow';
import { copy } from '../copy';
import { packOptions } from './skillPacks';
import { useUiStore } from '../state/uiStore';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Button } from '../ui/Button';
import { StateView, type ViewState } from '../ui/StateView';
import { AgentHud } from './AgentHud';
import { ChatWelcome } from './ChatWelcome';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { PlanBanner } from './PlanBanner';
import { ReviewBanner } from './ReviewBanner';
import { orbStateOf } from './AgentOrb';
import { useChatController } from './useChatController';

/** Langkah tool jawaban asisten terakhir (bagian `tool` tersimpan), untuk langkah turunan setelah muat ulang. */
function latestAssistantTools(messages: Message[]): SavedTool[] {
  const last = messages.findLast((m) => m.author === 'assistant');
  return (last?.parts ?? []).flatMap((part) =>
    part.type === 'tool'
      ? [
          {
            id: part.toolCallId,
            name: part.name,
            target: part.target,
            status: part.status,
            durationMs: part.durationMs,
          },
        ]
      : [],
  );
}

function ChatView({ conversationId }: { conversationId: string | undefined }) {
  const chat = useChatController(conversationId);
  const templates = usePromptTemplates();
  const insert = useTemplateInsert(chat.setDraft);
  const [dragging, setDragging] = useState(false);
  const { status } = chat;
  const now = useNow();
  const setAgentSteps = useUiStore((s) => s.setAgentSteps);
  const steps = useMemo(() => activitySteps(chat.live, chat.messages), [chat.live, chat.messages]);
  // Panel Aktivitas dan penanda di tab Berkas membaca langkah agent dari sini; hilang bersama chatnya.
  useEffect(() => {
    setAgentSteps(steps);
    return () => setAgentSteps([]);
  }, [steps, setAgentSteps]);
  // Panel Progres dan chip topbar membaca percakapan dan run terbaru dari sini.
  const setProgressSource = useUiStore((s) => s.setProgressSource);
  const savedTools = useMemo(() => latestAssistantTools(chat.messages), [chat.messages]);
  const progressRunId = (chat.live ?? chat.finished)?.runId ?? null;
  useEffect(() => {
    if (!conversationId) return;
    setProgressSource({ conversationId, runId: progressRunId, savedTools });
    return () => setProgressSource(null);
  }, [conversationId, progressRunId, savedTools, setProgressSource]);
  const setAgentSubagents = useUiStore((s) => s.setAgentSubagents);
  const subagents = chat.live?.subagents;
  useEffect(() => {
    setAgentSubagents(subagents ?? []);
    return () => setAgentSubagents([]);
  }, [subagents, setAgentSubagents]);

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

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        chat.addFiles([...event.dataTransfer.files]);
      }}
    >
      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-panel border-2 border-dashed border-accent bg-bg/80 text-ui text-text"
        >
          {copy.chat.files.drop}
        </div>
      ) : null}
      {chat.online ? null : (
        <ErrorBanner tone="warning" message={copy.states.offline} className="m-3 mb-0" />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {conversationId === undefined && !hasContent ? (
          <ChatWelcome inProject={chat.inProject} onPick={chat.prefill} />
        ) : (
          <StateView
            state={view}
            loadingLabel={copy.chat.loadingMessages}
            emptyMessage={copy.chat.emptyThread}
            errorMessage={status.isError ? apiErrorMessage(status.error, chat.online) : ''}
            offlineMessage={copy.states.offline}
            retryLabel={copy.states.retry}
            onRetry={() => void status.refetch()}
            emptyAction={
              <Button variant="secondary" onClick={() => chat.prefill(chat.draft)}>
                {copy.chat.startWriting}
              </Button>
            }
          >
            <MessageList
              messages={chat.messages}
              roles={chat.roles}
              pending={chat.pending}
              live={chat.live}
              finished={chat.finished}
              now={now}
              failure={chat.failure}
              editableUserId={chat.editableUserId}
              onResendLast={chat.resendLast}
              canModify={chat.canModify}
              onEditMessage={chat.editMessage}
              onDeleteMessage={chat.deleteMessage}
              onForkMessage={chat.forkMessage}
              onSuggest={chat.sendText}
              onRichFollowUp={chat.sendRichFollowUp}
              approvals={chat.approvals}
              resolvingApprovals={chat.resolvingApprovals}
              onResolveApproval={chat.resolveApproval}
              onAnswerQuestion={chat.answerQuestion}
              hasMore={chat.hasMore}
              loadingOlder={chat.loadingOlder}
              onLoadOlder={chat.loadOlder}
            />
          </StateView>
        )}
      </div>
      {chat.reviewRunId ? <ReviewBanner runId={chat.reviewRunId} /> : null}
      {chat.awaitingPlanApproval ? (
        <PlanBanner onApprove={chat.approvePlan} disabled={chat.sending || !chat.online} />
      ) : null}
      <AgentHud live={chat.live} onRemoveQueued={chat.removeQueued} />
      <Composer
        draft={chat.draft}
        onDraft={chat.setDraft}
        onSend={chat.send}
        onStop={chat.stop}
        onSteer={chat.canSteer ? chat.steer : undefined}
        streaming={chat.streaming}
        phase={chat.live ? orbStateOf(buildActivity(chat.live, now).phase) : undefined}
        sending={chat.sending}
        models={chat.models}
        model={chat.model}
        onModel={chat.setModel}
        // Chat umum berjalan di Hermes, yang mengabaikan pilihan model (BACKLOG Sesi 2).
        modelLockedReason={chat.supportsModelPick ? undefined : copy.chat.model.hermesFixed}
        engine={chat.engine}
        engineOptions={chat.engineOptions}
        onEngine={chat.setEngine}
        canEditLast={chat.canEditLast}
        onEditLast={chat.editLast}
        focusNonce={chat.focusNonce}
        attachments={chat.attachments}
        onRemoveAttachment={chat.removeAttachment}
        files={chat.files}
        onAddFiles={chat.addFiles}
        onRemoveFile={chat.removeFile}
        templates={templates.data ?? []}
        onUseTemplate={insert.use}
        webSearch={chat.webSearch}
        onWebSearch={chat.setWebSearch}
        skillPacks={chat.skillPacks}
        onSkillPacks={chat.setSkillPacks}
        skillOptions={packOptions(chat.inProject)}
        {...(chat.inProject ? { planMode: chat.planFirst, onPlanMode: chat.setPlanFirst } : {})}
      />
      {insert.dialog}
    </div>
  );
}

/** Layar chat umum. Dikunci per percakapan supaya isian dan pilihan tidak bocor antar percakapan. */
export function ChatScreen({ conversationId }: { conversationId?: string }) {
  return <ChatView key={conversationId ?? 'new'} conversationId={conversationId} />;
}
