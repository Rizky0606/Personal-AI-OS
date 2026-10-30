import type { Project } from '@aios/contracts';
import { PROJECT_INSTRUCTIONS_MAX } from '@aios/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { DialogFrame } from '../screens/DialogFrame';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { TextArea } from '../ui/TextArea';
import { useToastStore } from '../ui/Toaster';

export interface ProjectRulesDialogProps {
  /** Project yang aturannya diubah; null = dialog tertutup. */
  project: Project | null;
  onClose: () => void;
}

/** Aturan project (W23): instruksi yang ikut di setiap run coding dan chat project ini. */
export function ProjectRulesDialog({ project, onClose }: ProjectRulesDialogProps) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const r = copy.projects.rules;

  useEffect(() => {
    if (project) {
      setValue(project.instructions);
      setError(null);
    }
  }, [project]);

  async function save() {
    if (!project || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateProject(project.id, { instructions: value.trim() });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      push(r.saved);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, online));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      open={project !== null}
      onOpenChange={(open) => !open && onClose()}
      title={project ? r.title(project.name) : ''}
      description={r.intro}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {copy.chat.cancel}
          </Button>
          <Button variant="primary" disabled={!online || saving} onClick={() => void save()}>
            {saving ? r.saving : r.save}
          </Button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <TextArea
        label={r.label}
        hint={r.counter(value.trim().length, PROJECT_INSTRUCTIONS_MAX)}
        placeholder={r.placeholder}
        value={value}
        rows={10}
        maxLength={PROJECT_INSTRUCTIONS_MAX}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        className="font-mono"
      />
    </DialogFrame>
  );
}
