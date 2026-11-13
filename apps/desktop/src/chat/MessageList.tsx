import type { Message, QuestionAnswer } from '@aios/contracts';
import type { RoleInfo } from '../api/gateway';
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useConversationProgress } from '../api/queries';
import { api } from '../app/services';
import { copy } from '../copy';
import { buildActivity, savedActivity, type SavedTool } from '../realtime/activity';
import { isSettled, type LiveRun, type PendingApproval } from '../realtime/liveRun';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorBanner } from '../ui/ErrorBanner';
import { RememberDialog } from '../memory/RememberDialog';
import { ApprovalPanel } from './ApprovalPanel';
import { QuestionPanel } from './QuestionPanel';
import { SkillProposalCards } from './SkillProposalCards';
import { orbStateOf } from './AgentOrb';
import { AssistantMessage, type AssistantPart } from './AssistantMessage';
import { HandoffNote, isHandoffNote } from './HandoffNote';
import { messageText } from './messageData';
import type { ArtifactRef } from './RunActivity';
import { UserMessage } from './UserMessage';

export interface MessageListProps {
  messages: Message[];
  roles: RoleInfo[];
  /** Teks pesan pengguna yang belum dikonfirmasi server. */
  pending: string | null;
  live: LiveRun | undefined;
  /** Jejak run yang baru selesai di sesi ini (tanpa teks); memberi jawabannya baris aktivitas lengkap dengan waktu nyata. */
  finished?: LiveRun | undefined;
  /** Jam bersama (ms epoch) untuk timer baris aktivitas. */
  now: number;
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
  onSuggest?: (text: string) => void;
  onRichFollowUp?: ComponentProps<typeof AssistantMessage>['onRichFollowUp'];
  /** Permintaan izin agent yang menunggu jawaban pengguna. */
  approvals: PendingApproval[];
  resolvingApprovals: ReadonlySet<string>;
  onResolveApproval: (approvalId: string, decision: 'allow' | 'deny', remember: boolean) => void;
  /** Jawaban atas pertanyaan agent (id pertanyaan dipakai juga di `resolvingApprovals` selama terkirim). */
  onAnswerQuestion?: (
    questionId: string,
    result: { answers: QuestionAnswer[]; cancelled: boolean },
  ) => void;
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

/** Bagian tool tersimpan sebuah pesan, untuk ringkasan jawaban lama. */
function savedTools(parts: AssistantPart[]): SavedTool[] {
  return parts.flatMap((p) =>
    p.type === 'tool'
      ? [{ id: p.id, name: p.name, target: p.target, status: p.status, durationMs: p.durationMs }]
      : [],
  );
}

const scrollToApproval = () =>
  document.querySelector('[data-approval-panel]')?.scrollIntoView({ block: 'center' });

type SavedAssistantProps = Omit<ComponentProps<typeof AssistantMessage>, 'run' | 'orb'> & {
  runId: string | null;
  conversationId: string;
};

/**
 * Jawaban lama (setelah muat ulang atau buka percakapan): ringkasan terlipat dari bagian tool dan waktu run yang
 * tersimpan. Run diambil hanya bila jawaban punya langkah tool; jawaban teks biasa tidak mendapat baris.
 */
function SavedAssistantMessage({ runId, conversationId, ...props }: SavedAssistantProps) {
  const tools = savedTools(props.parts);
  // Berkas hasil kerja run ini dibaca dari agregat progress (cache yang sama dengan panel Progres), jadi
  // thumbnail di baris aktivitas tetap ada setelah muat ulang.
  const progress = useConversationProgress(runId !== null ? conversationId : undefined);
  const artifacts = useMemo<ArtifactRef[]>(
    () =>
      (progress.data?.outputs ?? []).flatMap((o) =>
        (o.kind === 'image' || o.kind === 'file') && o.runId === runId
          ? [{ fileId: o.fileId, name: o.name, mime: o.mime }]
          : [],
      ),
    [progress.data, runId],
  );
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId!),
    enabled: runId !== null && (tools.length > 0 || artifacts.length > 0),
    retry: false,
    staleTime: 60_000,
  });
  if (tools.length === 0 && artifacts.length === 0) return <AssistantMessage {...props} />;
  const activity = savedActivity(tools, run.data ?? null);
  return (
    <AssistantMessage
      {...props}
      orb={orbStateOf(activity.phase)}
      run={{ activity, now: 0, artifacts }}
    />
  );
}

/** Jawaban tersimpan: aktivitas dari run yang baru selesai di sesi ini bila ada, selain itu dari data tersimpan. */
function AssistantRow({
  finished,
  now,
  runId,
  ...props
}: SavedAssistantProps & { finished: LiveRun | undefined; now: number }) {
  if (finished && runId !== null && finished.runId === runId) {
    const activity = buildActivity(finished, now);
    // Run yang baru selesai di sesi ini selalu punya baris (juga tanpa langkah), supaya aktivitasnya bisa dibuka.
    return (
      <AssistantMessage
        {...props}
        orb={orbStateOf(activity.phase)}
        run={{
          activity,
          now,
          output: finished.tools.at(-1)?.output,
          artifacts: finished.artifacts,
          onApproval: scrollToApproval,
        }}
      />
    );
  }
  return <SavedAssistantMessage runId={runId} {...props} />;
}

function liveParts(live: LiveRun): AssistantPart[] {
  return [
    ...live.tools.map((tool): AssistantPart => ({ type: 'tool', ...tool })),
    { type: 'text', text: live.text },
  ];
}

/** Jawaban yang sedang mengalir: Orb mengikuti fase, baris aktivitas hidup di dalamnya. */
function LiveAssistant({
  live,
  roles,
  streaming,
  now,
}: {
  live: LiveRun;
  roles: RoleInfo[];
  streaming: boolean;
  now: number;
}) {
  const activity = buildActivity(live, now);
  return (
    <AssistantMessage
      parts={liveParts(live)}
      reasoning={live.reasoning}
      role={live.role}
      model={null}
      roles={roles}
      streaming={streaming}
      orb={orbStateOf(activity.phase)}
      run={{
        activity,
        now,
        output: live.tools.at(-1)?.output,
        artifacts: live.artifacts,
        onApproval: scrollToApproval,
      }}
    />
  );
}

/** Daftar pesan yang mengikuti ujung bawah selama pengguna belum menggulir ke atas. */
export function MessageList({
  messages,
  roles,
  pending,
  live,
  finished,
  now,
  failure,
  editableUserId = null,
  onResendLast,
  canModify = false,
  onEditMessage,
  onDeleteMessage,
  onForkMessage,
  onSuggest,
  onRichFollowUp,
  approvals,
  resolvingApprovals,
  onResolveApproval,
  onAnswerQuestion,
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
      <div className="mx-auto flex max-w-[calc(var(--aios-chat-measure)+6.5rem)] flex-col gap-8 px-8 py-8">
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
            <AssistantRow
              key={message.id}
              runId={message.runId}
              conversationId={message.conversationId}
              finished={finished}
              now={now}
              parts={assistantParts(message)}
              role={message.agentRole}
              model={message.model}
              roles={roles}
              onDelete={modifiable ? () => setToDelete(message.id) : undefined}
              onFork={canModify && onForkMessage ? () => onForkMessage(message.id) : undefined}
              onSuggest={message.id === lastAssistantId ? onSuggest : undefined}
              onRichFollowUp={message.id === lastAssistantId ? onRichFollowUp : undefined}
              footer={
                <SkillProposalCards
                  conversationId={message.conversationId}
                  messageId={message.id}
                />
              }
            />
          ) : message.author === 'system' && isHandoffNote(messageText(message)) ? (
            <HandoffNote key={message.id} text={messageText(message)} />
          ) : null,
        )}
        {pending ? <UserMessage text={pending} /> : null}
        {live ? <LiveAssistant live={live} roles={roles} streaming={streaming} now={now} /> : null}
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
