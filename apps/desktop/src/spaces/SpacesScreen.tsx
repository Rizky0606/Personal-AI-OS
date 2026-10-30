import { useState, type FormEvent } from 'react';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Page, PageHeader } from '../screens/PageLayout';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import { useSpaceActions } from './useSpaceActions';

/** Ruang pengetahuan (W21): penjelasan singkat dan formulir ruang baru; daftarnya ada di sidebar. */
export function SpacesScreen() {
  const online = useOnline();
  const { busy, create } = useSpaceActions();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const s = copy.spaces;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    if (await create(name, description)) {
      setName('');
      setDescription('');
    }
  }

  return (
    <Page width="md">
      <PageHeader
        title={s.title}
        description={s.summary}
        actions={
          <Button
            type="submit"
            form="space-create-form"
            variant="primary"
            disabled={!online || !name.trim() || busy !== null}
          >
            {busy === 'create' ? s.creating : s.create}
          </Button>
        }
      />
      <p className="max-w-[72ch] text-ui text-text-2">{s.intro}</p>
      <form
        id="space-create-form"
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-5"
      >
        <TextField
          label={s.name}
          placeholder={s.namePlaceholder}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <TextArea
          label={s.description}
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {!online ? <p className="text-meta text-text-2">{copy.states.offline}</p> : null}
      </form>
    </Page>
  );
}
