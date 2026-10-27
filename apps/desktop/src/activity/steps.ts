import type { Message } from '@aios/contracts';
import type { LiveRun } from '../realtime/liveRun';
import type { ActivityStep } from './activity';

/**
 * Langkah tool run terbaru di percakapan: dari aliran live bila ada langkahnya, bila tidak dari jawaban asisten
 * terakhir yang tersimpan (supaya tetap terlihat setelah dimuat ulang).
 */
export function activitySteps(
  live: LiveRun | undefined,
  messages: readonly Message[],
): ActivityStep[] {
  if (live && live.tools.length > 0) {
    return live.tools.map((t) => ({ id: t.id, name: t.name, target: t.target, status: t.status }));
  }
  const last = [...messages].reverse().find((m) => m.author === 'assistant');
  if (!last) return [];
  return last.parts.flatMap((part): ActivityStep[] =>
    part.type === 'tool'
      ? [{ id: part.toolCallId, name: part.name, target: part.target, status: part.status }]
      : [],
  );
}
