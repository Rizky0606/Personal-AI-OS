import type { MemoryProposal } from '@aios/contracts';
import { MEMORY_TEXT_MAX } from '@aios/contracts';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useMemoryProposals } from '../api/queries';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';

/**
 * Usulan memori dari ekstraksi fakta di chat umum: Simpan, Ubah lalu simpan, atau Tolak. Tidak tampil bila tidak
 * ada usulan; saat memuat, daftar memori di bawahnya yang menunjukkan status memuat.
 */
export function MemoryProposals({
  online,
  disabled,
  onApprove,
  onReject,
}: {
  online: boolean;
  disabled: boolean;
  onApprove: (id: string, text?: string) => Promise<boolean>;
  onReject: (id: string) => void;
}) {
  const query = useMemoryProposals();
  const items = query.data ?? [];
  const m = copy.memory;

  if (query.isError && !query.data) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-panel border border-border bg-surface p-4"
      >
        <p className="flex-1 text-ui text-text-2">
          {online ? m.proposalsError : apiErrorMessage(query.error, online)}
        </p>
        <Button variant="secondary" disabled={!online} onClick={() => void query.refetch()}>
          {copy.states.retry}
        </Button>
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="memory-proposals" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h4 id="memory-proposals" className="text-ui font-semibold text-text">
          {m.proposalsTitle(items.length)}
        </h4>
        <p className="text-meta text-text-2">{m.proposalsIntro}</p>
      </div>
      <ul
        aria-label={m.proposalsLabel}
        className="flex flex-col divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface"
      >
        {items.map((proposal) => (
          <ProposalRow
            key={proposal.id}
            proposal={proposal}
            disabled={disabled}
            onApprove={(text) => onApprove(proposal.id, text)}
            onReject={() => onReject(proposal.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function ProposalRow({
  proposal,
  disabled,
  onApprove,
  onReject,
}: {
  proposal: MemoryProposal;
  disabled: boolean;
  onApprove: (text?: string) => Promise<boolean>;
  onReject: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(proposal.text);
  const m = copy.memory;

  async function saveEdited() {
    if (!value.trim()) return;
    if (await onApprove(value)) setEditing(false);
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      {editing ? (
        <TextArea
          label={m.proposalEditLabel}
          value={value}
          rows={2}
          maxLength={MEMORY_TEXT_MAX}
          autoFocus
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false);
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void saveEdited();
            }
          }}
        />
      ) : (
        <p className="text-ui text-text whitespace-pre-wrap">{proposal.text}</p>
      )}
      {proposal.kind === 'update' && proposal.targetText ? (
        <p className="text-meta text-text-2">{m.proposalReplaces(proposal.targetText)}</p>
      ) : null}
      <p className="text-meta text-text-3">{m.proposalEvidence(proposal.evidence)}</p>
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button variant="ghost" disabled={disabled} onClick={() => setEditing(false)}>
              {copy.chat.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={disabled || !value.trim()}
              onClick={() => void saveEdited()}
            >
              {m.proposalApprove}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={disabled} onClick={() => void onApprove()}>
              {m.proposalApprove}
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                setValue(proposal.text);
                setEditing(true);
              }}
            >
              {m.proposalEditApprove}
            </Button>
            <Button variant="ghost" disabled={disabled} onClick={onReject}>
              {m.proposalReject}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
