import type { SkillDetail, SkillEngine, SkillScan, SkillSummary } from '@aios/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../app/services';
import { copy } from '../copy';
import { DialogFrame } from '../screens/DialogFrame';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Switch } from '../ui/Switch';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import { ScanFindings } from './ScanFindings';
import { needsAcknowledge, skillErrorMessage } from './skillErrors';
import { useSkillActions } from './useSkillActions';

const ENGINES: SkillEngine[] = ['hermes', 'omp', 'dsh'];
const t = copy.skillsPage;
const e = t.editor;

export interface SkillEditorProps {
  /** null = skill baru. */
  skill: SkillSummary | null;
  open: boolean;
  onClose: () => void;
}

/** Dialog satu skill: buat/ubah (skill buatan, terpasang, usulan agent), lihat (bawaan), riwayat versi, arsip, hapus. */
export function SkillEditor({ skill, open, onClose }: SkillEditorProps) {
  const editable = skill?.editable !== false;
  const detail = useQuery({
    queryKey: ['skills', 'detail', skill?.id, skill?.checksum],
    queryFn: () => api.getSkill(skill!.id),
    enabled: open && skill !== null,
  });
  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={skill ? e.viewTitle(skill.name) : e.createTitle}
      description={e.description}
      size="lg"
      closeLabel={e.close}
    >
      {skill && detail.isPending ? <p className="text-meta text-text-2">{t.loading}</p> : null}
      {skill && detail.isError ? (
        <p role="alert" className="text-meta text-danger">
          {e.loadFailed}
        </p>
      ) : null}
      {skill === null || detail.data ? (
        <EditorBody
          key={
            detail.data ? `${detail.data.id}:${detail.data.version}:${detail.data.checksum}` : 'new'
          }
          initial={detail.data ?? null}
          summary={skill}
          editable={editable}
          onClose={onClose}
        />
      ) : null}
    </DialogFrame>
  );
}

function EditorBody({
  initial,
  summary,
  editable,
  onClose,
}: {
  initial: SkillDetail | null;
  summary: SkillSummary | null;
  editable: boolean;
  onClose: () => void;
}) {
  const { busy, run, online, push } = useSkillActions();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [engines, setEngines] = useState<SkillEngine[]>(
    initial?.engines ?? ['hermes', 'omp', 'dsh'],
  );
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [scan, setScan] = useState<SkillScan | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Isi berubah: hasil pemindai lama dan persetujuan tidak berlaku lagi.
  useEffect(() => {
    setScan(null);
    setAcknowledge(false);
  }, [body, description]);

  const dirty = initial
    ? name !== initial.name ||
      description !== initial.description ||
      body !== initial.body ||
      pinned !== (initial.pinned ?? false) ||
      engines.join() !== (initial.engines ?? []).join()
    : true;
  const valid = name.trim().length > 0 && description.trim().length > 0 && body.trim().length > 0;
  const dangerous = scan?.verdict === 'dangerous';

  const toggleEngine = (engine: SkillEngine) =>
    setEngines((cur) =>
      cur.includes(engine)
        ? cur.length > 1
          ? cur.filter((x) => x !== engine)
          : cur
        : ENGINES.filter((x) => x === engine || cur.includes(x)),
    );

  async function runScan() {
    const result = await run('scan', () => api.scanSkill(body, description));
    if (result) setScan(result);
  }

  async function save() {
    setError(null);
    const payload = {
      name: name.trim(),
      description: description.trim(),
      body,
      engines,
      pinned,
      ...(acknowledge ? { acknowledge: true } : {}),
    };
    const saved = await run(
      'save',
      () => (initial ? api.updateSkill(initial.id, payload) : api.createSkill(payload)),
      initial ? e.saved : e.created,
      // Pemindai menahan simpan: tampilkan temuannya di dialog, bukan toast generik.
      async (err) => {
        if (!needsAcknowledge(err)) return false;
        setError(skillErrorMessage(err, online));
        setScan(await api.scanSkill(body, description));
        return true;
      },
    );
    if (saved) {
      if (saved.hermesSync === 'failed') push(e.syncFailed, 'danger');
      onClose();
    }
  }

  const status = summary?.status ?? 'active';

  return (
    <div className="flex flex-col gap-4">
      {!editable ? <p className="text-meta text-text-2">{e.builtinNote}</p> : null}
      <TextField
        label={e.name}
        value={name}
        maxLength={80}
        readOnly={!editable}
        onChange={(ev) => setName(ev.target.value)}
      />
      <TextField
        label={e.summary}
        hint={e.summaryHint}
        value={description}
        maxLength={200}
        readOnly={!editable}
        onChange={(ev) => setDescription(ev.target.value)}
      />
      <TextArea
        label={e.body}
        rows={12}
        value={body}
        readOnly={!editable}
        className="font-mono"
        onChange={(ev) => setBody(ev.target.value)}
      />

      {editable ? (
        <>
          <div role="group" aria-label={e.engines} className="flex flex-wrap items-center gap-2">
            <span className="text-meta text-text-2">{e.engines}</span>
            {ENGINES.map((engine) => (
              <Chip
                key={engine}
                selected={engines.includes(engine)}
                onClick={() => toggleEngine(engine)}
              >
                {t.engines[engine]}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-3 text-ui text-text">
            <Switch label={e.pinned} checked={pinned} onChange={setPinned} />
            <span>{e.pinned}</span>
          </div>
          {summary && summary.source !== 'user' ? (
            <div className="flex items-center gap-3 text-ui text-text">
              <Switch
                label={e.trust}
                checked={summary.trust === 'trusted'}
                disabled={busy !== null}
                onChange={(on) =>
                  void run(
                    'trust',
                    () => api.updateSkill(summary.id, { trust: on ? 'trusted' : 'community' }),
                    e.saved,
                  )
                }
              />
              <span>
                {e.trust} <span className="text-meta text-text-2">· {e.trustHint}</span>
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {scan ? <ScanFindings scan={scan} /> : null}
      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}
      {dangerous ? (
        <label className="flex items-start gap-2 text-meta text-text">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(ev) => setAcknowledge(ev.target.checked)}
            className="mt-0.5"
          />
          {e.acknowledgeDanger}
        </label>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            disabled={!online || !body.trim() || busy !== null}
            onClick={() => void runScan()}
          >
            {busy === 'scan' ? e.scanning : e.scan}
          </Button>
          <Button
            variant="primary"
            disabled={!online || !valid || !dirty || busy !== null || (dangerous && !acknowledge)}
            onClick={() => void save()}
          >
            {busy === 'save' ? e.saving : initial ? e.save : e.create}
          </Button>
        </div>
      ) : null}

      {initial && summary && editable ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            disabled={!online || busy !== null}
            onClick={() =>
              void run(
                'archive',
                () => api.setSkillStatus(initial.id, status === 'archived' ? 'active' : 'archived'),
                e.statusChanged,
              )
            }
          >
            {status === 'archived' ? e.unarchive : e.archive}
          </Button>
          <Button
            variant="danger"
            disabled={!online || busy !== null}
            onClick={() => setConfirmDelete(true)}
          >
            {e.delete}
          </Button>
        </div>
      ) : null}

      {initial && summary && editable ? (
        <VersionHistory skill={initial} onRestored={onClose} />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={e.deleteTitle}
        body={e.deleteBody}
        confirmLabel={e.deleteConfirm}
        cancelLabel={e.cancel}
        destructive
        busy={busy === 'delete'}
        onConfirm={() =>
          void (async () => {
            const done = await run(
              'delete',
              async () => {
                await api.deleteSkill(initial!.id);
                return true;
              },
              e.removed,
            );
            setConfirmDelete(false);
            if (done) onClose();
          })()
        }
      />
    </div>
  );
}

function VersionHistory({ skill, onRestored }: { skill: SkillDetail; onRestored: () => void }) {
  const { busy, run, online } = useSkillActions();
  const versions = useQuery({
    queryKey: ['skills', 'versions', skill.id, skill.checksum],
    queryFn: () => api.listSkillVersions(skill.id),
  });
  const items = versions.data ?? [];
  return (
    <section aria-label={e.history} className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-ui font-semibold text-text">{e.history}</h3>
      {versions.isPending ? <p className="text-meta text-text-2">{t.loading}</p> : null}
      {versions.isSuccess && items.length === 0 ? (
        <p className="text-meta text-text-2">{e.historyEmpty}</p>
      ) : null}
      <ul className="flex flex-col">
        {items.map((v, index) => (
          <li
            key={v.version}
            className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-meta"
          >
            <span className="min-w-0 truncate text-text">
              {e.versionLine(v.version, v.changedBy)}
              <span className="text-text-3">
                {' '}
                · {new Date(v.createdAt).toLocaleString('id-ID')}
              </span>
            </span>
            {index === 0 ? (
              <span className="text-text-2">{e.current}</span>
            ) : (
              <Button
                aria-label={e.restoreLabel(v.version)}
                disabled={!online || busy !== null}
                onClick={() =>
                  void (async () => {
                    const done = await run(
                      `restore:${v.version}`,
                      () => api.restoreSkillVersion(skill.id, v.version),
                      e.restored,
                    );
                    if (done) onRestored();
                  })()
                }
              >
                {e.restore}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
