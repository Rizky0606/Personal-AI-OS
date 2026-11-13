import { useNavigate } from '@tanstack/react-router';
import { useUiStore } from '../state/uiStore';

/** Membuka halaman Skill langsung ke tinjauan satu usulan (dari kartu di jawaban atau panel Progres). */
export function useOpenProposal(): (proposalId: string) => void {
  const navigate = useNavigate();
  const setFocus = useUiStore((s) => s.setSkillsFocus);
  return (proposalId) => {
    setFocus({ proposalId });
    void navigate({ to: '/skills' });
  };
}
