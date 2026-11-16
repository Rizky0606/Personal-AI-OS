import type { AgentProposal } from '@aios/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import type { ApproveAgentProposalInput } from '../api/gateway';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { useToastStore } from '../ui/Toaster';

/** Pesan untuk baris usulan: kode khusus (sudah diputuskan, cron/zona waktu salah) diberi pesan sendiri. */
function proposalErrorMessage(error: unknown, online: boolean): string {
  const a = copy.agentProposals;
  if (error instanceof ApiProblem) {
    if (error.code === 'proposal_decided') return a.decided;
    if (error.code === 'invalid_cron') return a.invalidCron;
    if (error.code === 'invalid_timezone') return a.invalidTimezone;
    if (error.code === 'validation') return a.invalid;
  }
  return apiErrorMessage(error, online);
}

/** Aksi usulan; mengembalikan pesan kesalahan untuk baris, null bila berhasil. */
export interface AgentProposalActions {
  /** Id usulan yang sedang diproses. */
  busy: string | null;
  approve: (proposal: AgentProposal, input?: ApproveAgentProposalInput) => Promise<string | null>;
  reject: (proposal: AgentProposal) => Promise<string | null>;
}

/**
 * Setujui atau tolak usulan kartu/jadwal dari agent. Aksi mengembalikan pesan kesalahan (null bila berhasil) supaya
 * baris menampilkannya di tempat dan isian ubahan tidak hilang. Usulan yang sudah diputuskan (409) memuat ulang daftar.
 */
export function useAgentProposalActions(): AgentProposalActions {
  const queryClient = useQueryClient();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const [busy, setBusy] = useState<string | null>(null);

  const guarded = useCallback(
    async (
      proposal: AgentProposal,
      work: () => Promise<unknown>,
      done: string,
    ): Promise<string | null> => {
      setBusy(proposal.id);
      try {
        await work();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['agentProposals'] }),
          proposal.kind === 'task'
            ? queryClient.invalidateQueries({ queryKey: ['tasks', proposal.projectId] })
            : queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        ]);
        push(done);
        return null;
      } catch (error) {
        if (error instanceof ApiProblem && error.status === 409) {
          void queryClient.invalidateQueries({ queryKey: ['agentProposals'] });
        }
        return proposalErrorMessage(error, online);
      } finally {
        setBusy(null);
      }
    },
    [online, push, queryClient],
  );

  const a = copy.agentProposals;
  return {
    busy,
    approve: (proposal: AgentProposal, input: ApproveAgentProposalInput = {}) =>
      guarded(
        proposal,
        () => api.approveAgentProposal(proposal.id, input),
        proposal.kind === 'task'
          ? a.task.approved
          : input.schedule?.enabled === false
            ? a.schedule.approvedDisabled
            : a.schedule.approved,
      ),
    reject: (proposal: AgentProposal) =>
      guarded(proposal, () => api.rejectAgentProposal(proposal.id), a.rejected),
  };
}
