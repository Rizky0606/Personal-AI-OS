import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { DialogFrame } from '../screens/DialogFrame';
import { Button } from '../ui/Button';
import { ScanFindings } from './ScanFindings';
import { useSkillActions } from './useSkillActions';

const t = copy.skillsPage.hermes;
const r = t.review;

/**
 * Pratinjau impor satu skill Hermes: isi lengkap dan temuan pemindai terlihat dulu. Skill yang dinilai
 * peringatan atau berbahaya baru bisa diimpor setelah kotak persetujuan dicentang (acknowledge).
 */
export function HermesReviewDialog({
  name,
  onClose,
}: {
  name: string | null;
  onClose: () => void;
}) {
  const online = useOnline();
  const { busy, run } = useSkillActions();
  const [acknowledge, setAcknowledge] = useState(false);
  const preview = useQuery({
    queryKey: ['skillHermes', 'preview', name],
    queryFn: () => api.previewHermesSkill(name!),
    enabled: name !== null,
    // Isi bisa berubah di folder Hermes; selalu baca ulang saat dialog dibuka.
    gcTime: 0,
  });
  useEffect(() => {
    setAcknowledge(false);
  }, [name]);

  const p = preview.data;
  const blocked = p ? !p.importable : false;
  const mustAck = p?.needsAcknowledge ?? false;

  return (
    <DialogFrame
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={r.title(name ?? '')}
      description={r.description}
      size="lg"
      closeLabel={r.close}
      footer={
        <>
          <Button onClick={onClose}>{r.cancel}</Button>
          <Button
            variant="primary"
            disabled={!online || !p || blocked || busy !== null || (mustAck && !acknowledge)}
            onClick={() =>
              void (async () => {
                const done = await run(
                  `import:${name}`,
                  () => api.importHermesSkill(name!, mustAck && acknowledge),
                  t.importedToast,
                );
                if (done) onClose();
              })()
            }
          >
            {busy === `import:${name}` ? t.importing : r.confirm}
          </Button>
        </>
      }
    >
      {preview.isPending ? (
        <p className="text-meta text-text-2">{copy.skillsPage.loading}</p>
      ) : null}
      {preview.isError ? (
        <p role="alert" className="text-meta text-danger">
          {r.loadFailed} {apiErrorMessage(preview.error, online)}
        </p>
      ) : null}
      {p ? (
        <>
          {blocked ? (
            <p role="alert" className="text-meta text-danger">
              {p.reason}
            </p>
          ) : null}
          {p.action === 'update' ? <p className="text-meta text-text-2">{r.updateNote}</p> : null}
          {p.candidate.mentionsScripts ? (
            <p className="text-meta text-warning">{r.scriptsNote}</p>
          ) : null}
          <ScanFindings scan={p.scan} />
          <section aria-label={r.body} className="flex flex-col gap-1">
            <h3 className="text-ui font-semibold text-text">{r.body}</h3>
            <pre className="max-h-72 overflow-auto rounded-control bg-surface-2 p-3 font-mono text-caption whitespace-pre-wrap text-text">
              {p.candidate.body}
            </pre>
          </section>
          {mustAck && !blocked ? (
            <label className="flex items-start gap-2 text-meta text-text">
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(ev) => setAcknowledge(ev.target.checked)}
                className="mt-0.5"
              />
              {p.scan.verdict === 'dangerous' ? r.acknowledgeDanger : r.acknowledgeWarn}
            </label>
          ) : null}
        </>
      ) : null}
    </DialogFrame>
  );
}
