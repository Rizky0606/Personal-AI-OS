import type { SkillProposalDetail, SkillScan } from '@aios/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { DialogFrame } from '../screens/DialogFrame';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import { hasChanges, lineDiff } from './lineDiff';
import { ScanFindings } from './ScanFindings';
import { skillErrorMessage } from './skillErrors';
import { useSkillActions } from './useSkillActions';

const t = copy.skillsPage.proposals;
const d = t.dialog;

/**
 * Tinjauan satu usulan skill (P11): alasan, isi, hasil pindai, dan untuk patch diff terhadap versi aktif. Aksi:
 * Setujui, Edit lalu setujui, Tolak. Tidak ada jalur lain yang mengaktifkan usulan.
 */
export function ProposalReviewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const online = useOnline();
  const detail = useQuery({
    queryKey: ['skillProposals', 'detail', id],
    queryFn: () => api.getSkillProposal(id!),
    enabled: id !== null,
    // Isi bisa berubah (folder Hermes, skill target); selalu baca ulang saat dialog dibuka.
    gcTime: 0,
  });
  return (
    <DialogFrame
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={d.title(detail.data?.name ?? '')}
      description={d.description}
      size="lg"
      closeLabel={d.close}
    >
      {detail.isPending ? <p className="text-meta text-text-2">{t.loading}</p> : null}
      {detail.isError ? (
        <p role="alert" className="text-meta text-danger">
          {d.loadFailed} {apiErrorMessage(detail.error, online)}
        </p>
      ) : null}
      {detail.data ? (
        <ReviewBody key={detail.data.id} proposal={detail.data} onClose={onClose} />
      ) : null}
    </DialogFrame>
  );
}

function ReviewBody({ proposal, onClose }: { proposal: SkillProposalDetail; onClose: () => void }) {
  const { busy, run, online } = useSkillActions();
  const isHermes = proposal.origin === 'hermes';
  const pending = proposal.status === 'pending';
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(proposal.name);
  const [description, setDescription] = useState(proposal.description);
  const [body, setBody] = useState(proposal.body);
  const [scan, setScan] = useState<SkillScan>(proposal.scan);
  const [acknowledge, setAcknowledge] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Isi disunting: persetujuan dan hasil pindai lama tidak berlaku lagi.
  const edited =
    editing &&
    (body !== proposal.body || description !== proposal.description || name !== proposal.name);
  useEffect(() => {
    setAcknowledge(false);
  }, [body, description]);

  const verdict = scan.verdict;
  const agentBlocked = !isHermes && verdict === 'dangerous';
  const mustAck = verdict !== 'safe' && !agentBlocked;
  const shownBody = editing ? body : proposal.body;
  const diff = useMemo(
    () => (proposal.existing ? lineDiff(proposal.existing.body, shownBody) : null),
    [proposal.existing, shownBody],
  );

  async function rescan() {
    const result = await run('scan', () => api.scanSkill(body, description));
    if (result) setScan(result);
  }

  async function approve() {
    setError(null);
    const done = await run(
      'approve',
      () =>
        api.approveSkillProposal(proposal.id, {
          ...(editing ? { name, description, body } : {}),
          acknowledge: mustAck && acknowledge,
        }),
      d.approved,
      (err) => {
        // Galat spesifik (pemindai, id bentrok, target hilang) tampil di dialog agar bisa langsung disunting.
        setError(skillErrorMessage(err, online));
        return true;
      },
    );
    if (done) onClose();
  }

  async function reject() {
    setError(null);
    const done = await run(
      'reject',
      () => api.rejectSkillProposal(proposal.id, reason),
      d.rejected,
      (err) => {
        setError(skillErrorMessage(err, online));
        return true;
      },
    );
    if (done) onClose();
  }

  const approveDisabled =
    !online ||
    busy !== null ||
    !proposal.approvable ||
    agentBlocked ||
    (mustAck && !acknowledge) ||
    (editing && (!name.trim() || !description.trim() || !body.trim()));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-text-3">
        {isHermes ? t.kinds.hermes : proposal.kind === 'patch' ? t.kinds.patch : t.kinds.new}
        {' · '}
        {t.status[proposal.status]}
      </p>
      {!pending ? (
        <p className="text-meta text-text-2">{d.decided(t.status[proposal.status])}</p>
      ) : null}
      {proposal.blockedReason && pending ? (
        <p role="alert" className="text-meta text-danger">
          {proposal.blockedReason}
        </p>
      ) : null}

      <section aria-label={d.reason} className="flex flex-col gap-1">
        <h3 className="text-ui font-semibold text-text">{d.reason}</h3>
        <p className="text-ui text-text-2">{proposal.reason}</p>
        {proposal.decisionNote ? (
          <p className="text-meta text-text-3">{proposal.decisionNote}</p>
        ) : null}
      </section>

      {editing ? (
        <>
          <TextField
            label={d.name}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label={d.summary}
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </>
      ) : (
        <p className="text-ui text-text">{proposal.description}</p>
      )}

      {proposal.existing && diff ? (
        <section
          aria-label={d.diffTitle(proposal.existing.version)}
          className="flex flex-col gap-1"
        >
          <h3 className="text-ui font-semibold text-text">
            {d.diffTitle(proposal.existing.version)}
          </h3>
          {hasChanges(diff) ? (
            <pre className="max-h-64 overflow-auto rounded-control bg-surface-2 p-3 font-mono text-caption">
              {diff.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'whitespace-pre-wrap',
                    line.kind === 'add' && 'bg-accent-soft text-text',
                    line.kind === 'remove' && 'text-danger line-through',
                    line.kind === 'same' && 'text-text-2',
                  )}
                >
                  <span aria-hidden="true">
                    {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
                  </span>
                  <span className="sr-only">
                    {line.kind === 'add' ? 'Ditambah: ' : line.kind === 'remove' ? 'Dihapus: ' : ''}
                  </span>
                  {line.text}
                </div>
              ))}
            </pre>
          ) : (
            <p className="text-meta text-text-2">{d.diffNone}</p>
          )}
        </section>
      ) : null}

      {editing ? (
        <TextArea
          label={d.body}
          rows={12}
          value={body}
          className="font-mono"
          onChange={(e) => setBody(e.target.value)}
        />
      ) : !proposal.existing ? (
        <section aria-label={d.body} className="flex flex-col gap-1">
          <h3 className="text-ui font-semibold text-text">{d.body}</h3>
          <pre className="max-h-72 overflow-auto rounded-control bg-surface-2 p-3 font-mono text-caption whitespace-pre-wrap text-text">
            {proposal.body}
          </pre>
        </section>
      ) : null}
      {isHermes ? <p className="text-meta text-text-2">{d.hermesNote}</p> : null}

      <ScanFindings scan={scan} />
      {edited ? (
        <div className="flex justify-end">
          <Button disabled={!online || busy !== null} onClick={() => void rescan()}>
            {busy === 'scan' ? d.scanning : d.scan}
          </Button>
        </div>
      ) : null}
      {agentBlocked && pending ? (
        <p role="alert" className="text-meta text-danger">
          {d.blockedDanger}
        </p>
      ) : null}
      {mustAck && pending && proposal.approvable ? (
        <label className="flex items-start gap-2 text-meta text-text">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(e) => setAcknowledge(e.target.checked)}
            className="mt-0.5"
          />
          {verdict === 'dangerous' ? d.acknowledgeDanger : d.acknowledgeWarn}
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}

      {rejecting ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <TextField
            label={d.rejectReason}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRejecting(false)}>{copy.skillsPage.editor.cancel}</Button>
            <Button
              variant="danger"
              disabled={!online || busy !== null}
              onClick={() => void reject()}
            >
              {busy === 'reject' ? d.rejecting : d.rejectConfirm}
            </Button>
          </div>
        </div>
      ) : pending ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button disabled={!online || busy !== null} onClick={() => setRejecting(true)}>
            {d.reject}
          </Button>
          {!isHermes && proposal.approvable ? (
            <Button
              disabled={busy !== null}
              onClick={() => {
                setEditing((on) => !on);
                setScan(proposal.scan);
              }}
            >
              {editing ? d.cancelEdit : d.editApprove}
            </Button>
          ) : null}
          <Button variant="primary" disabled={approveDisabled} onClick={() => void approve()}>
            {busy === 'approve' ? d.approving : editing ? d.saveApprove : d.approve}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
