import { workerBranchFor } from '@aios/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useMessages, useModels, useRoles } from '../api/queries';
import { useLiveRun, useOnline, useRunFailure } from '../app/hooks';
import { api, runs } from '../app/services';
import { copy } from '../copy';
import { isSettled } from '../realtime/liveRun';
import { useUiStore } from '../state/uiStore';
import { useToastStore } from '../ui/Toaster';
import { addMessageToCache, chronological, latestRunId, messageText } from './messageData';

/** Run yang statusnya sudah diperiksa saat membuka percakapan; mencegah getRun berulang per render. */
const checkedRuns = new Set<string>();

/**
 * Seluruh logika layar chat (pesan, kirim, hentikan, jalankan ulang, edit pesan terakhir) di luar komponen
 * tampilan. `conversationId` kosong berarti percakapan baru; percakapan dibuat saat pesan pertama dikirim.
 */
export function useChatController(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  const newChatSignal = useUiStore((s) => s.newChatSignal);
  const activeProjectId = useUiStore((s) => s.activeProjectId);
  const setRunBranch = useUiStore((s) => s.setActiveRunBranch);

  const messagesQuery = useMessages(conversationId);
  const modelsQuery = useModels();
  const rolesQuery = useRoles();

  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  const messages = useMemo(() => chronological(messagesQuery.data), [messagesQuery.data]);
  const runId = activeRunId ?? latestRunId(messages);
  const live = useLiveRun(runId);
  const failure = useRunFailure(runId);
  const streaming = live !== undefined && !isSettled(live.status);

  // Chat umum hanya menawarkan role Umum; role coding (omp) butuh project, jadi hanya muncul di dalam project.
  const roles = useMemo(
    () => (rolesQuery.data ?? []).filter((r) => activeProjectId !== null || r.group === 'umum'),
    [rolesQuery.data, activeProjectId],
  );

  // Status bar menampilkan branch kerja agent selama run coding berjalan.
  const liveRunId = live?.runId;
  const codingLive =
    streaming &&
    activeProjectId !== null &&
    roles.find((r) => r.id === live?.role)?.group === 'coding';
  useEffect(() => {
    if (!codingLive || !liveRunId) return;
    setRunBranch(workerBranchFor(liveRunId));
    return () => setRunBranch(null);
  }, [codingLive, liveRunId, setRunBranch]);

  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set());

  // Chat baru (Ctrl+N saat sudah di layar ini): kosongkan isian dan fokus.
  const [seenSignal, setSeenSignal] = useState(newChatSignal);
  useEffect(() => {
    if (newChatSignal === seenSignal) return;
    setSeenSignal(newChatSignal);
    if (conversationId === undefined) {
      setDraft('');
      setFocusNonce((n) => n + 1);
    }
  }, [newChatSignal, seenSignal, conversationId]);

  // Membuka percakapan yang jawabannya masih berjalan (aplikasi ditutup di tengah jawaban): lanjut mengikuti.
  const resumeId = latestRunId(messages);
  useEffect(() => {
    if (!resumeId || checkedRuns.has(resumeId) || runs.get(resumeId)) return;
    checkedRuns.add(resumeId);
    api
      .getRun(resumeId)
      .then((run) => {
        if (!isSettled(run.status)) runs.track(resumeId);
      })
      .catch(() => checkedRuns.delete(resumeId));
  }, [resumeId]);

  const fail = useCallback(
    (error: unknown, message?: string) => push(message ?? apiErrorMessage(error, online), 'danger'),
    [push, online],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || streaming) return;
    if (!online) {
      push(copy.chat.offlineSend, 'danger');
      return;
    }
    setSending(true);
    setPending(text);
    setDraft('');
    try {
      const id =
        conversationId ??
        (await api.createConversation('windows', activeProjectId ?? undefined)).id;
      const response = await api.sendMessage(id, {
        text,
        role: role ?? undefined,
        model: model ?? undefined,
      });
      addMessageToCache(queryClient, id, response.message);
      runs.track(response.run.id);
      setActiveRunId(response.run.id);
      setRole(null);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (conversationId === undefined) {
        void navigate({
          to: '/chat/$conversationId',
          params: { conversationId: id },
          replace: true,
        });
      }
    } catch (error) {
      setDraft((current) => current || text);
      fail(error, `${copy.chat.sendFailed} ${apiErrorMessage(error, online)}`);
    } finally {
      setPending(null);
      setSending(false);
    }
  }, [
    draft,
    sending,
    streaming,
    online,
    push,
    conversationId,
    activeProjectId,
    role,
    model,
    queryClient,
    navigate,
    fail,
  ]);

  const stop = useCallback(async () => {
    if (!live) return;
    try {
      await api.cancelRun(live.runId);
    } catch (error) {
      fail(error, `${copy.chat.stopFailed} ${apiErrorMessage(error, online)}`);
    }
  }, [live, fail, online]);

  const lastAssistant = [...messages].reverse().find((m) => m.author === 'assistant');
  const lastUser = [...messages].reverse().find((m) => m.author === 'user');

  const reroute = useCallback(
    async (nextRole: string) => {
      if (!lastAssistant || streaming) return;
      try {
        const response = await api.rerouteMessage(lastAssistant.id, nextRole);
        runs.track(response.run.id);
        setActiveRunId(response.run.id);
      } catch (error) {
        fail(error, `${copy.chat.rerouteFailed} ${apiErrorMessage(error, online)}`);
      }
    },
    [lastAssistant, streaming, fail, online],
  );

  /** Keputusan atas permintaan izin agent; status run berubah lewat event, bukan dari sini. */
  const resolveApproval = useCallback(
    async (approvalId: string, decision: 'allow' | 'deny', remember: boolean) => {
      if (!live) return;
      setResolving((current) => new Set(current).add(approvalId));
      try {
        await api.resolveApproval(live.runId, approvalId, { decision, remember });
      } catch (error) {
        fail(error, `${copy.approval.failed} ${apiErrorMessage(error, online)}`);
      } finally {
        setResolving((current) => {
          const next = new Set(current);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [live, fail, online],
  );

  /** API tidak punya edit di tempat: teks pesan terakhir dimasukkan ke kolom pesan lalu dikirim sebagai pesan baru. */
  const editLast = useCallback(() => {
    if (!lastUser || sending || streaming) return;
    setDraft(messageText(lastUser));
    setFocusNonce((n) => n + 1);
  }, [lastUser, sending, streaming]);

  const loadOlder = useCallback(() => void messagesQuery.fetchNextPage(), [messagesQuery]);

  return {
    messages,
    live,
    failure: failure ? failure.message : null,
    pending,
    draft,
    setDraft,
    role,
    setRole,
    model,
    setModel,
    models: modelsQuery.data ?? [],
    roles,
    approvals: live?.approvals ?? [],
    resolvingApprovals: resolving,
    resolveApproval: (approvalId: string, decision: 'allow' | 'deny', remember: boolean) =>
      void resolveApproval(approvalId, decision, remember),
    sending,
    streaming,
    send: () => void send(),
    stop: () => void stop(),
    reroute: (nextRole: string) => void reroute(nextRole),
    editLast,
    canEditLast: lastUser !== undefined && !sending && !streaming,
    rerunnableId: lastAssistant && !streaming ? lastAssistant.id : null,
    focusNonce,
    loadOlder,
    hasMore: messagesQuery.hasNextPage,
    loadingOlder: messagesQuery.isFetchingNextPage,
    status: messagesQuery,
    online,
  };
}
