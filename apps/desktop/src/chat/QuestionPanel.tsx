import type { Question, QuestionAnswer } from '@aios/contracts';
import { useId, useState } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';

interface Draft {
  selected: string[];
  custom: string;
}

export interface QuestionPanelProps {
  questions: readonly Question[];
  busy: boolean;
  /** `cancelled` membuat agent memakai pilihan yang direkomendasikan. */
  onSubmit: (result: { answers: QuestionAnswer[]; cancelled: boolean }) => void;
}

/** Jawaban awal: pilihan yang direkomendasikan agent, supaya menekan Kirim cukup untuk menerima sarannya. */
function initial(questions: readonly Question[]): Record<string, Draft> {
  return Object.fromEntries(
    questions.map((q) => {
      const rec = q.recommended !== undefined ? q.options[q.recommended]?.label : undefined;
      return [q.id, { selected: rec ? [rec] : [], custom: '' }];
    }),
  );
}

const answered = (d: Draft | undefined) => (d?.selected.length ?? 0) > 0 || !!d?.custom.trim();

/** Agent bertanya (tool `ask` omp): pilihan tunggal atau ganda, plus teks bebas; panel inline seperti permintaan izin. */
export function QuestionPanel({ questions, busy, onSubmit }: QuestionPanelProps) {
  const [drafts, setDrafts] = useState(() => initial(questions));
  const base = useId();
  const q = copy.question;

  function patch(question: Question, change: (d: Draft) => Draft) {
    setDrafts((all) => ({
      ...all,
      [question.id]: change(all[question.id] ?? { selected: [], custom: '' }),
    }));
  }

  function toggle(question: Question, label: string) {
    patch(question, (d) => {
      // omp menolak jawaban tunggal yang memuat pilihan sekaligus teks bebas.
      if (!question.multi) return { selected: [label], custom: '' };
      const selected = d.selected.includes(label)
        ? d.selected.filter((s) => s !== label)
        : [...d.selected, label];
      return { ...d, selected };
    });
  }

  function submit() {
    onSubmit({
      cancelled: false,
      answers: questions.map((question) => {
        const d = drafts[question.id];
        const custom = d?.custom.trim();
        return {
          id: question.id,
          selectedOptions: d?.selected ?? [],
          ...(custom ? { customInput: custom } : {}),
        };
      }),
    });
  }

  const ready = questions.every((question) => answered(drafts[question.id]));

  return (
    <section
      aria-label={q.title}
      className="flex animate-aios-rise flex-col gap-4 rounded-panel border border-accent bg-surface p-4 shadow-glow"
    >
      <h3 className="text-ui font-semibold text-text">{q.title}</h3>
      {questions.map((question, i) => {
        const name = `${base}-${i}`;
        const draft = drafts[question.id];
        return (
          <fieldset key={question.id} className="flex flex-col gap-2" disabled={busy}>
            <legend className="flex flex-col gap-1 text-ui text-text">
              {question.header ? (
                <span className="w-fit rounded-badge bg-accent-soft px-1.5 py-0.5 font-mono text-caption">
                  {question.header}
                </span>
              ) : null}
              <span>{question.question}</span>
              {question.multi ? <span className="text-meta text-text-3">{q.multiHint}</span> : null}
            </legend>
            {question.options.map((option, j) => (
              <label
                key={option.label}
                className="flex cursor-pointer items-start gap-2 rounded-control border border-border px-3 py-2 text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type={question.multi ? 'checkbox' : 'radio'}
                  name={name}
                  checked={draft?.selected.includes(option.label) ?? false}
                  onChange={() => toggle(question, option.label)}
                  className="mt-0.5 accent-accent"
                />
                <span className="flex min-w-0 flex-col">
                  <span>
                    {option.label}
                    {question.recommended === j ? (
                      <span className="ml-2 text-meta text-text-3">{q.recommended}</span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="text-meta text-text-2">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
            <label className="flex flex-col gap-1 text-meta text-text-2">
              {q.other}
              <input
                type="text"
                value={draft?.custom ?? ''}
                maxLength={2000}
                onChange={(event) =>
                  patch(question, (d) => ({
                    selected: question.multi ? d.selected : [],
                    custom: event.target.value,
                  }))
                }
                className="h-8 rounded-control border border-border bg-surface px-3 text-ui text-text focus:border-border-strong"
              />
            </label>
          </fieldset>
        );
      })}
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => onSubmit({ answers: [], cancelled: true })}
        >
          {q.useRecommended}
        </Button>
        <Button variant="primary" disabled={busy || !ready} onClick={submit}>
          {q.submit}
        </Button>
      </div>
    </section>
  );
}
