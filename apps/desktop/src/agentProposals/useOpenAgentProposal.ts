import type { AgentProposal } from '@aios/contracts';
import { useNavigate } from '@tanstack/react-router';
import { useUiStore } from '../state/uiStore';

/**
 * Membuka layar tempat usulan agent diputuskan (dari kartu di bawah jawaban): usulan kartu ke papan kanban
 * project-nya, usulan jadwal ke layar Jadwal. Keputusan tetap di layar itu, bukan di kartu chat.
 */
export function useOpenAgentProposal(): (proposal: AgentProposal) => void {
  const navigate = useNavigate();
  const setActiveProject = useUiStore((s) => s.setActiveProject);
  return (proposal) => {
    if (proposal.kind === 'task') {
      if (proposal.projectId) setActiveProject(proposal.projectId);
      void navigate({ to: '/kanban' });
      return;
    }
    void navigate({ to: '/schedules' });
  };
}
