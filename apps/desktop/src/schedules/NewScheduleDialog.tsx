import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '../api/errors';
import { api } from '../app/services';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { formatDateTime } from '../lib/time';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { Switch } from '../ui/Switch';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import type { ScheduleParse } from '../api/gateway';
import { useScheduleActions } from './useScheduleActions';

export interface NewScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-border py-2 text-ui">
      <dt className="text-text-2">{label}</dt>
      <dd className="min-w-0 break-words text-text">{children}</dd>
    </div>
  );
}

/**
 * Dua langkah: tulis jadwal dengan bahasa alami, lalu periksa hasil bacaan server. Tidak ada yang tersimpan
 * sebelum pengguna menekan Simpan jadwal.
 */
export function NewScheduleDialog({ open, onOpenChange, onCreated }: NewScheduleDialogProps) {
  const online = useOnline();
  const { create } = useScheduleActions();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ScheduleParse | null>(null);
  const [name, setName] = useState('');
  const [notify, setNotify] = useState<'always' | 'on_change'>('always');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<'parse' | 'save' | null>(null);

  function reset() {
    setText('');
    setParsed(null);
    setName('');
    setFieldError(undefined);
    setError(null);
    setWorking(null);
  }

  function change(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function parse(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    if (!text.trim()) {
      setFieldError(copy.schedules.dialog.emptyText);
      return;
    }
    setFieldError(undefined);
    setError(null);
    setWorking('parse');
    try {
      const result = await api.parseSchedule(text.trim());
      setParsed(result);
      setName(result.name);
      setNotify(result.notify);
    } catch (e) {
      setError(apiErrorMessage(e, online));
    } finally {
      setWorking(null);
    }
  }

  async function save() {
    if (!parsed || working) return;
    setError(null);
    setWorking('save');
    try {
      const schedule = await create({
        name: name.trim() || parsed.name,
        cron: parsed.cron,
        timezone: parsed.timezone,
        prompt: parsed.prompt,
        target: parsed.target,
        agentRole: parsed.agentRole,
        enabled: true,
        notify: parsed.target === 'research' ? 'always' : notify,
      });
      change(false);
      onCreated(schedule.id);
    } catch (e) {
      setError(apiErrorMessage(e, online));
      setWorking(null);
    }
  }

  const d = copy.schedules.dialog;
  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-20 left-1/2 z-50 flex max-h-[calc(100vh-10rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-4 overflow-y-auto rounded-panel border border-border bg-surface p-4 shadow-float"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-section font-semibold text-text">
              {parsed ? d.checkTitle : d.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={d.close}>
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>

          {error ? <ErrorBanner message={error} /> : null}

          {parsed ? (
            <div className="flex flex-col gap-3">
              <p className="text-meta text-text-2">{d.checkHint}</p>
              <TextField label={d.name} value={name} onChange={(e) => setName(e.target.value)} />
              <dl>
                <Row label={d.when}>{parsed.description}</Row>
                <Row label={d.cron}>
                  <span className="font-mono">{parsed.cron}</span>
                </Row>
                <Row label={d.timezone}>{parsed.timezone}</Row>
                <Row label={d.target}>
                  {copy.schedules.targets[parsed.target]}
                  {parsed.agentRole ? ` · ${parsed.agentRole}` : ''}
                </Row>
                <Row label={d.notify}>
                  <span className="flex items-center gap-2">
                    <Switch
                      checked={parsed.target !== 'research' && notify === 'on_change'}
                      disabled={parsed.target === 'research'}
                      label={copy.schedules.notify.label}
                      onChange={(on) => setNotify(on ? 'on_change' : 'always')}
                    />
                    <span>
                      {parsed.target === 'research'
                        ? copy.schedules.notify.researchHint
                        : notify === 'on_change'
                          ? copy.schedules.notify.on
                          : copy.schedules.notify.off}
                    </span>
                  </span>
                </Row>
                <Row label={d.prompt}>{parsed.prompt}</Row>
                <Row label={d.nextRuns}>
                  <ul className="flex flex-col">
                    {parsed.nextRuns.map((iso) => (
                      <li key={iso}>{formatDateTime(iso, parsed.timezone)}</li>
                    ))}
                  </ul>
                </Row>
              </dl>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={working !== null}
                  onClick={() => setParsed(null)}
                >
                  {d.edit}
                </Button>
                <Button variant="primary" disabled={working !== null} onClick={() => void save()}>
                  {working === 'save' ? d.saving : d.save}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void parse(e)} className="flex flex-col gap-3">
              <TextArea
                label={d.text}
                hint={d.textHint}
                error={fieldError}
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={working !== null}>
                  {working === 'parse' ? d.parsing : d.parse}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
