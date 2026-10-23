import { useState } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';

export interface CommentEditorProps {
  path: string;
  line: number;
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}

/** Penyunting komentar satu baris; Ctrl+Enter menyimpan, Esc membatalkan. */
export function CommentEditor({ path, line, initial, onSave, onCancel }: CommentEditorProps) {
  const [body, setBody] = useState(initial);
  const save = () => {
    if (body.trim()) onSave(body.trim());
  };
  return (
    <div className="flex flex-col gap-2 border-y border-border bg-surface p-2">
      <TextArea
        label={copy.review.commentLabel(path, line)}
        value={body}
        rows={3}
        autoFocus
        placeholder={copy.review.commentPlaceholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {copy.review.commentCancel}
        </Button>
        <Button variant="primary" disabled={!body.trim()} onClick={save}>
          {copy.review.commentSave}
        </Button>
      </div>
    </div>
  );
}

export interface CommentCardProps {
  body: string;
  onEdit: () => void;
  onRemove: () => void;
}

/** Komentar yang belum dikirim; baru terkirim ke agent lewat "Kirim komentar". */
export function CommentCard({ body, onEdit, onRemove }: CommentCardProps) {
  return (
    <div className="flex items-start gap-2 border-y border-border bg-accent-soft p-2">
      <p className="min-w-0 flex-1 text-ui break-words whitespace-pre-wrap text-text">{body}</p>
      <Button variant="ghost" className="h-6 px-2 text-meta" onClick={onEdit}>
        {copy.review.commentEdit}
      </Button>
      <Button variant="ghost" className="h-6 px-2 text-meta" onClick={onRemove}>
        {copy.review.commentRemove}
      </Button>
    </div>
  );
}
