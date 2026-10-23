import type { Conversation } from '@aios/contracts';
import { Link } from '@tanstack/react-router';
import { Archive, MoreHorizontal, Pencil, Pin, PinOff } from 'lucide-react';
import { useState } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { ActionMenu } from '../ui/ActionMenu';
import { IconButton } from '../ui/IconButton';

export interface ConversationRowProps {
  conversation: Conversation;
  active: boolean;
  onRename: (title: string) => void;
  onPin: (pinned: boolean) => void;
  onArchive: () => void;
}

const icon = { size: 14, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Baris 32px dengan menu ⋯ (ubah judul, sematkan, arsipkan). Judul bisa diubah langsung di tempat. */
export function ConversationRow({
  conversation,
  active,
  onRename,
  onPin,
  onArchive,
}: ConversationRowProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const label = conversation.title || copy.chat.untitled;

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
        'group flex min-h-8 items-center border-b border-border',
        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
    >
      <Link
        to="/chat/$conversationId"
        params={{ conversationId: conversation.id }}
        aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-3 text-ui text-text"
      >
        {conversation.pinned ? (
          <Pin
            {...icon}
            aria-label={copy.chat.pinned}
            aria-hidden={false}
            className="shrink-0 text-text-3"
          />
        ) : null}
        <span className="truncate">{label}</span>
      </Link>
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
            {
              id: 'archive',
              label: copy.chat.archive,
              icon: <Archive {...icon} />,
              onSelect: onArchive,
              danger: true,
            },
          ]}
        />
      </span>
    </div>
  );
}
