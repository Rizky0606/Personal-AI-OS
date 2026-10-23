import { ChevronRight } from 'lucide-react';
import { copy } from '../copy';

/** Penalaran model, terlipat secara bawaan; teksnya mono kecil supaya tidak bersaing dengan jawaban. */
export function ReasoningBlock({ text }: { text: string }) {
  return (
    <details className="group text-ui text-text-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-badge hover:text-text">
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          aria-hidden="true"
          className="transition-transform duration-[120ms] group-open:rotate-90"
        />
        {copy.chat.reasoning}
      </summary>
      <p className="mt-1 max-w-[72ch] border-l-2 border-border pl-3 font-mono text-meta whitespace-pre-wrap">
        {text}
      </p>
    </details>
  );
}
