import type { SkillInstallPreview } from '@aios/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { ScanFindings } from './ScanFindings';
import { skillErrorMessage } from './skillErrors';
import { hasChanges, lineDiff } from './lineDiff';
import { useSkillActions } from './useSkillActions';

const t = copy.skillsPage.install;

/** Pasang dari luar: pratinjau (isi, pemindai, diff) lalu pasang dengan checksum yang dilihat pengguna. */
export function InstallTab() {
  const { busy, run, online } = useSkillActions();
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<{ source: string; data: SkillInstallPreview } | null>(
    null,
  );
  const [acknowledge, setAcknowledge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview(event?: FormEvent) {
    event?.preventDefault();
    const value = source.trim();
    if (!value || busy) return;
    setError(null);
    setAcknowledge(false);
    setPreview(null);
    const data = await run(
      'preview',
      () => api.previewSkillInstall(value),
      undefined,
      (err) => {
        setError(skillErrorMessage(err, online));
        return true;
      },
    );
    if (data) setPreview({ source: value, data });
  }

  async function install() {
    if (!preview) return;
    setError(null);
    const done = await run(
      'install',
      () => api.installSkill(preview.source, preview.data.candidate.checksum, acknowledge),
      t.installed,
      (err) => {
        // 409 checksum: sumber berubah sejak pratinjau; paksa pratinjau ulang.
        setError(`${skillErrorMessage(err, online)} ${t.changedSince}`.trim());
        return true;
      },
    );
    if (done) {
      setPreview(null);
      setSource('');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-ui text-text-2">{t.intro}</p>
      <form onSubmit={(ev) => void loadPreview(ev)} className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label={t.source}
            placeholder={t.sourcePlaceholder}
            value={source}
            maxLength={500}
            onChange={(ev) => setSource(ev.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={!online || !source.trim() || busy !== null}
        >
          {busy === 'preview' ? t.previewing : t.preview}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}
      {preview ? (
        <PreviewCard
          data={preview.data}
          acknowledge={acknowledge}
          onAcknowledge={setAcknowledge}
          busy={busy === 'install'}
          disabled={!online || busy !== null}
          onInstall={() => void install()}
        />
      ) : null}
    </div>
  );
}

function PreviewCard({
  data,
  acknowledge,
  onAcknowledge,
  busy,
  disabled,
  onInstall,
}: {
  data: SkillInstallPreview;
  acknowledge: boolean;
  onAcknowledge: (v: boolean) => void;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
}) {
  const { candidate, scan, existing, action } = data;
  const diff = useMemo(
    () => (existing ? lineDiff(existing.body, candidate.body) : null),
    [existing, candidate.body],
  );
  const needsAck = scan.verdict === 'warning';
  const canInstall = data.installable && scan.verdict !== 'dangerous' && (!needsAck || acknowledge);
  return (
    <section
      aria-label={t.candidate}
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-5"
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="text-section font-semibold text-text">{candidate.name}</h3>
        <p className="text-meta text-text-2">{candidate.description}</p>
        <p className="text-caption text-text-3">
          {t.actions[action]} · <code className="font-mono">{candidate.id}</code> ·{' '}
          {t.checksum(candidate.checksum)}
        </p>
      </header>
      {candidate.mentionsScripts ? <p className="text-meta text-warning">{t.scriptsNote}</p> : null}
      {candidate.descriptionTrimmed ? (
        <p className="text-meta text-text-2">{t.trimmedNote}</p>
      ) : null}
      <ScanFindings scan={scan} />
      {!data.installable ? (
        <p role="alert" className="text-meta text-danger">
          {t.blocked} {data.reason ?? ''}
        </p>
      ) : null}

      {existing && diff ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-ui font-semibold text-text">{t.diffTitle(existing.version)}</h4>
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
            <p className="text-meta text-text-2">{t.diffNone}</p>
          )}
        </div>
      ) : (
        <pre
          aria-label={t.candidate}
          className="max-h-64 overflow-auto rounded-control bg-surface-2 p-3 font-mono text-caption whitespace-pre-wrap text-text"
        >
          {candidate.body}
        </pre>
      )}

      {needsAck && data.installable ? (
        <label className="flex items-start gap-2 text-meta text-text">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(ev) => onAcknowledge(ev.target.checked)}
            className="mt-0.5"
          />
          {t.acknowledgeWarn}
        </label>
      ) : null}
      <div className="flex justify-end">
        <Button variant="primary" disabled={disabled || !canInstall} onClick={onInstall}>
          {busy ? t.installing : action === 'update' ? t.update : t.install}
        </Button>
      </div>
    </section>
  );
}
