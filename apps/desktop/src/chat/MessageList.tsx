import type { Message } from '@aios/contracts';
import type { RoleInfo } from '../api/gateway';
import { useLayoutEffect, useRef } from 'react';
import { copy } from '../copy';
import { isTerminal, type LiveRun } from '../realtime/liveRun';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { AssistantMessage, type AssistantPart } from './AssistantMessage';
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
  /** Jawaban asisten terakhir: satu-satunya yang chip rolenya bisa diganti. */
  rerunnableId: string | null;
  onReroute: (role: string) => void;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}

const STICK_THRESHOLD = 48;

function assistantParts(message: Message): AssistantPart[] {
  return message.parts.flatMap((part): AssistantPart[] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
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
  rerunnableId,
  onReroute,
  hasMore,
  loadingOlder,
  onLoadOlder,
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const streaming = live !== undefined && !isTerminal(live.status);
  // Selama run berjalan, jawabannya ditampilkan dari aliran live, bukan dari daftar (hindari ganda).
  const shown = live
    ? messages.filter((m) => !(m.author === 'assistant' && m.runId === live.runId))
    : messages;

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
            <UserMessage key={message.id} text={messageText(message)} />
          ) : message.author === 'assistant' ? (
            <AssistantMessage
              key={message.id}
              parts={assistantParts(message)}
              role={message.agentRole}
              model={message.model}
              roles={roles}
              onChangeRole={message.id === rerunnableId ? onReroute : undefined}
            />
          ) : null,
        )}
        {pending ? <UserMessage text={pending} /> : null}
        {live ? (
          <div className="flex flex-col gap-2">
            <AssistantMessage
              parts={liveParts(live)}
              reasoning={live.reasoning}
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
          </div>
        ) : null}
        {failure !== null ? (
          <ErrorBanner
            message={failure ? `${copy.chat.runFailed} ${failure}` : copy.chat.runFailed}
          />
        ) : null}
      </div>
    </div>
  );
}
