import { useNavigate } from '@tanstack/react-router';
import { copy } from '../copy';
import { Button } from './Button';

/** Aksi keadaan kosong "belum ada project aktif": menuju layar Workspace untuk memilih project. */
export function PickProjectButton() {
  const navigate = useNavigate();
  return (
    <Button variant="secondary" onClick={() => void navigate({ to: '/workspace' })}>
      {copy.states.pickProject}
    </Button>
  );
}

/** Aksi keadaan kosong "worker belum tersambung": menuju layar Status. */
export function WorkerStatusButton() {
  const navigate = useNavigate();
  return (
    <Button variant="secondary" onClick={() => void navigate({ to: '/status' })}>
      {copy.states.viewStatus}
    </Button>
  );
}
