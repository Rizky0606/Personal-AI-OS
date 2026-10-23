import type { Stack } from '@aios/contracts';
import { copy } from '../copy';

/** Bahasa dan framework sebagai label kecil; mono karena itu identifier teknis. */
export function StackChips({ stack }: { stack: Stack }) {
  const items = [...stack.languages, ...stack.frameworks];
  if (items.length === 0) {
    return <span className="text-meta text-text-3">{copy.projects.noStack}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-badge bg-surface-2 px-2 py-0.5 font-mono text-caption text-text-2"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
