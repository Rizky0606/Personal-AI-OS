import type { ResearchDepth } from '@aios/contracts';
import { useState, type FormEvent } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { TextArea } from '../ui/TextArea';
import { useResearchActions } from './useResearchActions';

const DEPTHS: ResearchDepth[] = ['quick', 'standard', 'deep'];

/** Form riset baru: pertanyaan dan kedalaman. Setelah dimulai, layar pindah ke detail dengan progres live. */
export function ResearchFormScreen() {
  const { busy, start } = useResearchActions();
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState<ResearchDepth>('standard');
  const [error, setError] = useState<string | undefined>();
  const submitting = busy === 'create';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const text = question.trim();
    if (!text) {
      setError(copy.research.form.emptyQuestion);
      return;
    }
    setError(undefined);
    void start(text, depth);
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4 p-6">
      <h2 className="text-section font-semibold text-text">{copy.research.form.title}</h2>
      <TextArea
        label={copy.research.form.question}
        hint={copy.research.form.questionHint}
        error={error}
        rows={5}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-meta text-text-2">{copy.research.form.depth}</legend>
        <div role="radiogroup" aria-label={copy.research.form.depth} className="flex gap-2">
          {DEPTHS.map((id) => (
            <Chip
              key={id}
              role="radio"
              aria-checked={depth === id}
              selected={depth === id}
              onClick={() => setDepth(id)}
            >
              {copy.research.form.depths[id]}
            </Chip>
          ))}
        </div>
        <p className="text-caption text-text-3">{copy.research.form.depthHints[depth]}</p>
      </fieldset>
      <div>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? copy.research.form.submitting : copy.research.form.submit}
        </Button>
      </div>
    </form>
  );
}
