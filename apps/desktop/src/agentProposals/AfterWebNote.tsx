import { TriangleAlert } from 'lucide-react';
import { copy } from '../copy';

/**
 * Peringatan bahwa agent membaca halaman web sebelum mengusulkan. Dipakai di baris usulan agent, kartu usulan di
 * chat, dan usulan memori dari agent, supaya peringatannya persis sama di semua tempat.
 */
export function AfterWebNote() {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-meta text-text"
    >
      <TriangleAlert
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-warning"
      />
      {copy.agentProposals.afterWeb}
    </p>
  );
}
