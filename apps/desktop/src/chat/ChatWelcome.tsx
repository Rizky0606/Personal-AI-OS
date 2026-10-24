import { Bug, Code2, FileText, FlaskConical, FolderTree, Mail, Plus, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '../copy';

export interface ChatWelcomeProps {
  /** Chat di dalam project: saran mengarah ke pekerjaan coding. */
  inProject: boolean;
  /** Mengisi kolom pesan dengan teks saran (belum dikirim). */
  onPick: (prompt: string) => void;
}

const icon = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

const GENERAL_ICONS: ReactNode[] = [
  <FileText key="f" {...icon} />,
  <Bug key="b" {...icon} />,
  <Mail key="m" {...icon} />,
  <Code2 key="c" {...icon} />,
];
const PROJECT_ICONS: ReactNode[] = [
  <FolderTree key="t" {...icon} />,
  <Wrench key="w" {...icon} />,
  <Plus key="p" {...icon} />,
  <FlaskConical key="x" {...icon} />,
];

/** Jeda antar kartu saat muncul bertahap (DESIGN_SYSTEM: maksimal 4 elemen × 40 ms). */
const STAGGER_MS = 40;

/**
 * Sambutan chat kosong: cahaya aksen kecil yang bernapas, satu kalimat kerja, dan kartu saran. Composer tetap
 * terlihat dan fokus di bawah; kartu hanya mengisi kolom pesan.
 */
export function ChatWelcome({ inProject, onPick }: ChatWelcomeProps) {
  const text = inProject ? copy.chat.welcome.project : copy.chat.welcome.general;
  const icons = inProject ? PROJECT_ICONS : GENERAL_ICONS;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 py-10">
      <div className="relative flex size-16 items-center justify-center" aria-hidden="true">
        <div className="aios-orb absolute -inset-6 animate-aios-orb rounded-full" />
        <div className="aios-primary relative size-3 rounded-full shadow-glow" />
      </div>
      <div className="flex animate-aios-rise flex-col items-center gap-1 text-center">
        <h2 className="text-page font-semibold text-text">{text.title}</h2>
        <p className="max-w-[56ch] text-ui text-text-2">{text.subtitle}</p>
      </div>
      <ul
        aria-label={copy.chat.suggestionsLabel}
        className="grid w-full max-w-[calc(72ch+4rem)] grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {text.cards.map((card, i) => (
          <li
            key={card.title}
            className="animate-aios-rise"
            style={{ animationDelay: `${(i + 1) * STAGGER_MS}ms` }}
          >
            <button
              type="button"
              onClick={() => onPick(card.prompt)}
              className="group flex w-full items-start gap-3 rounded-panel border border-border bg-surface p-3 text-left transition duration-[180ms] ease-spring hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift active:translate-y-0"
            >
              <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-2 transition-colors duration-[180ms] ease-aios group-hover:bg-accent-soft group-hover:text-text">
                {icons[i]}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-text">{card.title}</span>
                <span className="text-meta text-text-2">{card.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
