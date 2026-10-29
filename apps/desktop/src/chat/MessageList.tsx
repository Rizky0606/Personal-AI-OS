import type { Message, QueueName, QuestionAnswer } from '@aios/contracts';
import type { RoleInfo } from '../api/gateway';
import { useLayoutEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { X } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { isSettled, type LiveRun, type PendingApproval } from '../realtime/liveRun';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorBanner } from '../ui/ErrorBanner';
import { RememberDialog } from '../memory/RememberDialog';
import { ApprovalPanel } from './ApprovalPanel';
import { QuestionPanel } from './QuestionPanel';
import { AssistantMessage, type AssistantPart } from './AssistantMessage';
import { HandoffNote, isHandoffNote } from './HandoffNote';
import { messageText } from './messageData';
import { UserMessage } from './UserMessage';

export interface MessageListProps {
  messages: Message[];
  roles: RoleInfo[];
  /** Teks pesan pengguna yang belum dikonfirmasi server. */
  pending: string | null;
  live: LiveRun | undefined;
  /** Pesan kegagalan run terakhir, bila ada. */
  failure: string | null;
  /** Pesan pengguna terakhir yang boleh dikirim ulang (null saat jawaban berjalan). */
  editableUserId?: string | null;
  onResendLast?: () => void;
  /** Ubah dan hapus pesan hanya saat tidak ada jawaban yang berjalan. */
  canModify?: boolean;
  onEditMessage?: (messageId: string, text: string) => Promise<boolean>;
  onDeleteMessage?: (messageId: string) => Promise<boolean>;
  /** Cabangkan percakapan dari jawaban asisten; hanya saat tidak ada jawaban yang berjalan. */
  onForkMessage?: (messageId: string) => void;
  /** Mengirim saran lanjutan dari jawaban terakhir. */
  onSuggest?: (text: string) => void;
  /** Permintaan izin agent yang menunggu jawaban pengguna. */
  approvals: PendingApproval[];
  resolvingApprovals: ReadonlySet<string>;
  onResolveApproval: (approvalId: string, decision: 'allow' | 'deny', remember: boolean) => void;
  /** Jawaban atas pertanyaan agent (id pertanyaan dipakai juga di `resolvingApprovals` selama terkirim). */
  onAnswerQuestion?: (
    questionId: string,
    result: { answers: QuestionAnswer[]; cancelled: boolean },
  ) => void;
  /** Menarik arahan dari antrean agent; tanpa ini tombol tarik tidak tampil. */
  onRemoveQueued?: (queue: QueueName, text: string) => void;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}

const STICK_THRESHOLD = 48;

function assistantParts(message: Message): AssistantPart[] {
  return message.parts.flatMap((part): AssistantPart[] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.type === 'file') {
      return [{ type: 'file', fileId: part.fileId, name: part.name, mime: part.mime }];
    }
    if (part.type === 'tool') {
      return [
        {
          type: 'tool',
          id: part.toolCallId,
          name: part.name,
          target: part.target,
          status: part.status,
          durationMs: part.durationMs,
        },
      ];
    }
    return [];
  });
}

function liveParts(live: LiveRun): AssistantPart[] {
  return [
    ...live.tools.map((tool): AssistantPart => ({ type: 'tool', ...tool })),
    { type: 'text', text: live.text },
  ];
}

/** Daftar pesan yang mengikuti ujung bawah selama pengguna belum menggulir ke atas. */
export function MessageList({
  messages,
  roles,
  pending,
  live,
  failure,
  editableUserId = null,
  onResendLast,
  canModify = false,
  onEditMessage,
  onDeleteMessage,
  onForkMessage,
  onSuggest,
  approvals,
  resolvingApprovals,
  onResolveApproval,
  onAnswerQuestion,
  onRemoveQueued,
  hasMore,
  loadingOlder,
  onLoadOlder,
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toRemember, setToRemember] = useState<string | null>(null);
  const modifiable = canModify && !!onDeleteMessage;
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const streaming = live !== undefined && !isSettled(live.status);
  // Selama run berjalan, jawabannya ditampilkan dari aliran live, bukan dari daftar (hindari ganda).
  const shown = live
    ? messages.filter((m) => !(m.author === 'assistant' && m.runId === live.runId))
    : messages;

  // Saran lanjutan hanya untuk jawaban paling akhir, selama tidak ada jawaban yang sedang mengalir.
  const lastAssistantId =
    streaming || pending
      ? null
      : ([...shown].reverse().find((m) => m.author === 'assistant')?.id ?? null);

  return (
    <div
      ref={scroller}
      role="log"
      aria-label={copy.chat.messages}
      aria-busy={streaming}
      onScroll={(event) => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex max-w-[calc(72ch+4rem)] flex-col gap-6 px-8 py-6">
        {hasMore ? (
          <Button
            variant="ghost"
            disabled={loadingOlder}
            onClick={onLoadOlder}
            className="self-center"
          >
            {loadingOlder ? copy.states.loading : copy.chat.loadOlder}
          </Button>
        ) : null}
        {shown.map((message) =>
          message.author === 'user' ? (
            <UserMessage
              key={message.id}
              text={messageText(message)}
              sentAt={message.createdAt}
              files={message.parts.flatMap((part) => (part.type === 'file' ? [part] : []))}
              onEdit={
                canModify && onEditMessage
                  ? (text: string) => onEditMessage(message.id, text)
                  : undefined
              }
              onResend={message.id === editableUserId ? onResendLast : undefined}
              onDelete={modifiable ? () => setToDelete(message.id) : undefined}
              onRemember={() => setToRemember(messageText(message))}
            />
          ) : message.author === 'assistant' ? (
            <AssistantMessage
              key={message.id}
              parts={assistantParts(message)}
              role={message.agentRole}
              model={message.model}
              roles={roles}
              onDelete={modifiable ? () => setToDelete(message.id) : undefined}
              onFork={canModify && onForkMessage ? () => onForkMessage(message.id) : undefined}
              onSuggest={message.id === lastAssistantId ? onSuggest : undefined}
            />
          ) : message.author === 'system' && isHandoffNote(messageText(message)) ? (
            <HandoffNote key={message.id} text={messageText(message)} />
          ) : null,
        )}
        {pending ? <UserMessage text={pending} /> : null}
        {live ? (
          <div className="flex flex-col gap-2">
            <AssistantMessage
              parts={liveParts(live)}
              reasoning={live.reasoning}
              todos={live.todos}
              role={live.role}
              model={null}
              roles={roles}
              streaming={streaming}
            />
            {streaming && !live.text ? (
              <p role="status" className="text-meta text-text-2">
                {copy.runStatus[live.status]}…
              </p>
            ) : null}
            {live.queue.steering.length + live.queue.followUp.length > 0 ? (
              <ul
                aria-label={copy.chat.queue.title}
                className="flex animate-aios-enter flex-col gap-1 text-meta text-text-2"
              >
                {live.queue.steering.map((text, i) => (
                  <li key={`s${i}`} className="flex items-baseline gap-2">
                    <span className="rounded-badge bg-accent-soft px-1.5 py-0.5 font-mono text-caption text-text">
                      {copy.chat.queue.steering}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{text}</span>
                    {onRemoveQueued ? (
                      <IconButton
                        label={copy.chat.queue.remove(text)}
                        onClick={() => onRemoveQueued('steering', text)}
                      >
                        <X size={14} strokeWidth={1.5} aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </li>
                ))}
                {live.queue.followUp.map((text, i) => (
                  <li key={`f${i}`} className="flex items-baseline gap-2">
                    <span className="rounded-badge bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text">
                      {copy.chat.queue.followUp}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{text}</span>
                    {onRemoveQueued ? (
                      <IconButton
                        label={copy.chat.queue.remove(text)}
                        onClick={() => onRemoveQueued('followUp', text)}
                      >
                        <X size={14} strokeWidth={1.5} aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {approvals.map((approval) => (
          <ApprovalPanel
            key={approval.approvalId}
            approval={approval}
            busy={resolvingApprovals.has(approval.approvalId)}
            onResolve={(decision, remember) =>
              onResolveApproval(approval.approvalId, decision, remember)
            }
          />
        ))}
        {onAnswerQuestion
          ? (live?.questions ?? []).map((pending) => (
              <QuestionPanel
                key={pending.questionId}
                questions={pending.questions}
                busy={resolvingApprovals.has(pending.questionId)}
                onSubmit={(result) => onAnswerQuestion(pending.questionId, result)}
              />
            ))
          : null}
        {failure !== null ? (
          <ErrorBanner
            message={failure ? `${copy.chat.runFailed} ${failure}` : copy.chat.runFailed}
          />
        ) : null}
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title={copy.chat.deleteMessageTitle}
        body={copy.chat.deleteMessageBody}
        confirmLabel={copy.chat.deleteMessageConfirm}
        cancelLabel={copy.chat.cancel}
        destructive
        busy={deleting}
        onConfirm={() => {
          if (!toDelete || !onDeleteMessage) return;
          setDeleting(true);
          void onDeleteMessage(toDelete).finally(() => {
            setDeleting(false);
            setToDelete(null);
          });
        }}
      />
      <RememberDialog text={toRemember} onClose={() => setToRemember(null)} />
    </div>
  );
}
