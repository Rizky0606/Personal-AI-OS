import {
  SETUP_COMMAND_MAX,
  SETUP_MAX_COMMANDS,
  SetupCommandSchema,
  type Project,
} from '@aios/contracts';
import { useEffect, useState } from 'react';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { DialogFrame } from '../screens/DialogFrame';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Switch } from '../ui/Switch';
import { TextArea } from '../ui/TextArea';
import { useToastStore } from '../ui/Toaster';
import { workerErrorMessage } from '../worker/errors';

export interface ProjectSetupDialogProps {
  /** Project yang setup-nya diatur; null = dialog tertutup. */
  project: Project | null;
  onClose: () => void;
}

/** Baris tidak kosong; indeks 1-based baris pertama yang tidak lolos skema, atau null bila semua sah. */
function firstInvalid(lines: string[]): number | null {
  const at = lines.findIndex((line) => !SetupCommandSchema.safeParse(line).success);
  return at === -1 ? null : at + 1;
}

/** Setup worktree (disimpan di worker PC ini): perintah yang dijalankan sebelum agent mulai dan tautan node_modules. */
export function ProjectSetupDialog({ project, onClose }: ProjectSetupDialogProps) {
  const [text, setText] = useState('');
  const [link, setLink] = useState(false);
  const [lsp, setLsp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const push = useToastStore((s) => s.push);
  const s = copy.projects.setup;

  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    workerApi
      .setupGet(projectId)
      .then((setup) => {
        if (cancelled) return;
        setText(setup.commands.join('\n'));
        setLink(setup.linkNodeModules);
        setLsp(setup.lsp);
      })
      .catch((e: unknown) => !cancelled && setError(workerErrorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const invalid = firstInvalid(lines);
  const problem =
    lines.length > SETUP_MAX_COMMANDS
      ? s.tooMany(SETUP_MAX_COMMANDS)
      : invalid !== null
        ? s.invalid(invalid)
        : undefined;

  async function save() {
    if (!project || saving || problem) return;
    setSaving(true);
    setError(null);
    try {
      await workerApi.setupSet(project.id, { commands: lines, linkNodeModules: link, lsp });
      push(s.saved);
      onClose();
    } catch (e) {
      setError(workerErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      open={project !== null}
      onOpenChange={(open) => !open && onClose()}
      title={project ? s.title(project.name) : ''}
      description={s.intro}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {copy.chat.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={loading || saving || problem !== undefined}
            onClick={() => void save()}
          >
            {saving ? s.saving : s.save}
          </Button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <TextArea
        label={s.commandsLabel}
        hint={s.commandsHint(lines.length, SETUP_MAX_COMMANDS)}
        error={problem}
        placeholder={s.commandsPlaceholder}
        value={loading ? s.loading : text}
        rows={6}
        maxLength={SETUP_MAX_COMMANDS * (SETUP_COMMAND_MAX + 1)}
        disabled={loading || saving}
        onChange={(event) => setText(event.target.value)}
        className="font-mono"
      />
      <div className="flex flex-col divide-y divide-border rounded-control border border-border">
        <div className="flex items-start gap-3 px-3 py-3">
          <Switch checked={link} onChange={setLink} label={s.link} disabled={loading || saving} />
          <div className="flex flex-col">
            <span className="text-ui text-text">{s.link}</span>
            <span className="text-caption text-text-3">{s.linkHint}</span>
          </div>
        </div>
        <div className="flex items-start gap-3 px-3 py-3">
          <Switch checked={lsp} onChange={setLsp} label={s.lsp} disabled={loading || saving} />
          <div className="flex flex-col">
            <span className="text-ui text-text">{s.lsp}</span>
            <span className="text-caption text-text-3">{s.lspHint}</span>
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
