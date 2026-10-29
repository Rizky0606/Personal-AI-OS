import type { Conversation } from '@aios/contracts';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  CornerDownRight,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useLiveConversationIds } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { ActionMenu } from '../ui/ActionMenu';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { IconButton } from '../ui/IconButton';

export interface ConversationRowProps {
  conversation: Conversation;
  active: boolean;
  onRename: (title: string) => void;
  onPin: (pinned: boolean) => void;
  onArchive: () => void;
  /** Ringkas lalu lanjut di percakapan baru. */
  onHandoff?: () => void;
  /** Hapus permanen (setelah konfirmasi). */
  onDelete: () => void;
}

const icon = { size: 14, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Baris 32px dengan menu ⋯ (ubah judul, sematkan, arsipkan, hapus). Judul bisa diubah langsung di tempat. */
export function ConversationRow({
  conversation,
  active,
  onRename,
  onPin,
  onArchive,
  onHandoff,
  onDelete,
}: ConversationRowProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const label = conversation.title || copy.chat.untitled;
  const running = useLiveConversationIds().has(conversation.id);

  const linkClass = 'flex min-w-0 flex-1 items-center gap-2 py-1 pl-3 text-ui text-text';
  const linkContent = (
    <>
      {conversation.pinned ? (
        <Pin
          {...icon}
          aria-label={copy.chat.pinned}
          aria-hidden={false}
          className="shrink-0 text-text-3"
        />
      ) : null}
      <span className="truncate">{label}</span>
      {running ? (
        <span
          role="img"
          aria-label={copy.chat.running}
          className="ml-auto size-2 shrink-0 animate-aios-breathe rounded-full bg-writing"
        />
      ) : null}
    </>
  );

  function commit() {
    setEditing(false);
    const next = title.trim();
    if (next && next !== conversation.title) onRename(next);
  }

  if (editing) {
    return (
      <div className="flex min-h-8 items-center border-b border-border px-2">
        <input
          autoFocus
          aria-label={copy.chat.renameLabel}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setEditing(false);
          }}
          className="h-7 w-full rounded-control border border-border-strong bg-surface px-2 text-ui text-text"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex min-h-8 items-center border-b border-border transition-colors duration-[120ms] ease-aios',
        'before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent before:shadow-glow before:transition-transform before:duration-[180ms] before:ease-spring',
        active ? 'aios-active-wash before:scale-y-100' : 'before:scale-y-0 hover:bg-surface-2',
      )}
    >
      {conversation.projectId ? (
        <Link
          to="/workspace/$projectId/$conversationId"
          params={{ projectId: conversation.projectId, conversationId: conversation.id }}
          aria-current={active ? 'page' : undefined}
          className={linkClass}
        >
          {linkContent}
        </Link>
      ) : (
        <Link
          to="/chat/$conversationId"
          params={{ conversationId: conversation.id }}
          aria-current={active ? 'page' : undefined}
          className={linkClass}
        >
          {linkContent}
        </Link>
      )}
      <span className="opacity-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100">
        <ActionMenu
          trigger={
            <IconButton label={`${copy.chat.menu}: ${label}`}>
              <MoreHorizontal {...icon} />
            </IconButton>
          }
          actions={[
            {
              id: 'rename',
              label: copy.chat.rename,
              icon: <Pencil {...icon} />,
              onSelect: () => {
                setTitle(conversation.title);
                setEditing(true);
              },
            },
            {
              id: 'pin',
              label: conversation.pinned ? copy.chat.unpin : copy.chat.pin,
              icon: conversation.pinned ? <PinOff {...icon} /> : <Pin {...icon} />,
              onSelect: () => onPin(!conversation.pinned),
            },
            ...(onHandoff
              ? [
                  {
                    id: 'handoff',
                    label: copy.chat.handoff.menu,
                    icon: <CornerDownRight {...icon} />,
                    onSelect: onHandoff,
                  },
                ]
              : []),
            {
              id: 'archive',
              label: copy.chat.archive,
              icon: <Archive {...icon} />,
              onSelect: onArchive,
            },
            {
              id: 'delete',
              label: copy.chat.deleteConversation,
              icon: <Trash2 {...icon} />,
              onSelect: () => setConfirmDelete(true),
              danger: true,
            },
          ]}
        />
      </span>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={copy.chat.deleteConversationTitle}
        body={copy.chat.deleteConversationBody(label)}
        confirmLabel={copy.chat.deleteConversation}
        cancelLabel={copy.chat.cancel}
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
      />
    </div>
  );
}
