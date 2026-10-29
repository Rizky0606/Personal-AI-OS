import { useState, type FormEvent } from 'react';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';
import { PageContainer } from '../ui/PageContainer';
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
    <PageContainer>
      <header className="flex flex-col gap-2">
        <h2 className="text-page font-semibold text-text">{s.title}</h2>
        <p className="max-w-[72ch] text-ui text-text-2">{s.intro}</p>
      </header>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
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
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={!online || !name.trim() || busy !== null}
          >
            {busy === 'create' ? s.creating : s.create}
          </Button>
        </div>
        {!online ? <p className="text-meta text-text-2">{copy.states.offline}</p> : null}
      </form>
    </PageContainer>
  );
}
