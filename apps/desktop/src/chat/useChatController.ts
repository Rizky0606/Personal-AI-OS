import { withAttachments } from '../preview/attachment';
import {
  workerBranchFor,
  type QueueName,
  type QuestionAnswer,
  type RichAnswerFollowUp,
} from '@aios/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { skillsOfPacks } from './skillPacks';
import { useMessages, useModels, useRoles } from '../api/queries';
import { useFinishedRun, useLiveRun, useOnline, useRunFailure } from '../app/hooks';
import { api, runs } from '../app/services';
import { copy } from '../copy';
import { isSettled } from '../realtime/liveRun';
import { useUiStore } from '../state/uiStore';
import { useToastStore } from '../ui/Toaster';
import { goConversation } from './paths';
import { useFileAttachments } from './useFileAttachments';
import { useReviewTarget } from './useReviewTarget';
import {
  addMessageToCache,
  chronological,
  latestRunId,
  messageText,
  truncateCache,
} from './messageData';

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
  const attachments = useUiStore((s) => s.attachments);
  const removeAttachment = useUiStore((s) => s.removeAttachment);
  const clearAttachments = useUiStore((s) => s.clearAttachments);

  const messagesQuery = useMessages(conversationId);
  const modelsQuery = useModels();
  const rolesQuery = useRoles();

  const [draft, setDraft] = useState('');
  const model = useUiStore((s) => s.model);
  const webSearch = useUiStore((s) => s.webSearch);
  const setWebSearch = useUiStore((s) => s.setWebSearch);
  const skillPacks = useUiStore((s) => s.skillPacks);
  const setSkillPacks = useUiStore((s) => s.setSkillPacks);
  const setModel = useUiStore((s) => s.setModel);
  const setActiveRole = useUiStore((s) => s.setActiveRole);
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  /** Mode rencana: pesan berikutnya di project hanya membuat rencana, tanpa mengubah berkas. */
  const [planFirst, setPlanFirst] = useState(false);
  const attach = useFileAttachments(online);

  const messages = useMemo(() => chronological(messagesQuery.data), [messagesQuery.data]);
  const runId = activeRunId ?? latestRunId(messages);
  const live = useLiveRun(runId);
  const finished = useFinishedRun(runId);
  const failure = useRunFailure(runId);
  const streaming = live !== undefined && !isSettled(live.status);
  const reviewRunId = useReviewTarget(runId ?? undefined, live);
  // Run rencana yang sudah selesai menunggu persetujuan pemilik sebelum dikerjakan.
  const planRun = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId!),
    enabled: runId !== null && runId !== undefined,
    retry: false,
  });
  const planStatus = live?.status ?? planRun.data?.status;
  const awaitingPlanApproval =
    planRun.data?.planOnly === true && planStatus === 'completed' && !streaming;
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
    // Run revisi memakai branch run sebelumnya; panel review sudah mengisinya, jangan ditimpa.
    if (useUiStore.getState().activeRunBranch === null) setRunBranch(workerBranchFor(liveRunId));
    return () => setRunBranch(null);
  }, [codingLive, liveRunId, setRunBranch]);

  // Status bar menampilkan role yang dipakai: keputusan router untuk jawaban ini.
  const shownRole = live?.role ?? null;
  useEffect(() => {
    setActiveRole(shownRole);
    return () => setActiveRole(null);
  }, [shownRole, setActiveRole]);

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
        if (!isSettled(run.status)) runs.track(resumeId, run.conversationId ?? undefined);
      })
      .catch(() => checkedRuns.delete(resumeId));
  }, [resumeId]);

  const fail = useCallback(
    (error: unknown, message?: string) => push(message ?? apiErrorMessage(error, online), 'danger'),
    [push, online],
  );

  /** Mengirim isi kolom pesan, atau `override` (kirim ulang) tanpa menyentuh draf yang sedang diketik. */
  const send = useCallback(
    async (override?: string, options?: { plan?: boolean; followUp?: RichAnswerFollowUp }) => {
      const text = (override ?? draft).trim();
      // Kirim ulang hanya teks; lampiran di composer ikut pada kiriman biasa.
      const files = override === undefined ? attach.parts : [];
      if (
        (!text && files.length === 0 && !options?.followUp) ||
        sending ||
        streaming ||
        attach.uploading
      )
        return;
      if (!online) {
        push(copy.chat.offlineSend, 'danger');
        return;
      }
      // Konteks dari preview (elemen terpilih) dikirim bersama pesan ini.
      const sentAttachments = attachments;
      const body = withAttachments(text, sentAttachments);
      setSending(true);
      setPending(body || files.map((f) => f.name).join(', '));
      if (override === undefined) setDraft('');
      try {
        let id = conversationId;
        if (id === undefined) {
          const created = await api.createConversation('windows', activeProjectId ?? undefined);
          // Sudah diketahui: rute tujuan tidak perlu memuatnya lagi (jawaban yang sedang tampil tidak berkedip).
          queryClient.setQueryData(['conversation', created.id], created);
          id = created.id;
        }
        const response = await api.sendMessage(id, {
          text: body || (options?.followUp ? `Rich answer ${options.followUp.action}` : ''),
          files: files.length ? files : undefined,
          model: model ?? undefined,
          planOnly: (options?.plan ?? planFirst) && activeProjectId !== null ? true : undefined,
          webSearch: webSearch ? true : undefined,
          skills: skillsOfPacks(skillPacks),
          followUp: options?.followUp,
        });
        addMessageToCache(queryClient, id, response.message);
        setSkillPacks([]);
        clearAttachments();
        if (override === undefined) attach.clear();
        runs.track(response.run.id, response.run.conversationId ?? undefined);
        setActiveRunId(response.run.id);
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        if (conversationId === undefined) {
          void goConversation(navigate, { id, projectId: activeProjectId }, true);
        }
      } catch (error) {
        if (override === undefined) setDraft((current) => current || text);
        fail(error, `${copy.chat.sendFailed} ${apiErrorMessage(error, online)}`);
      } finally {
        setPending(null);
        setSending(false);
      }
    },
    [
      draft,
      attach,
      sending,
      streaming,
      online,
      push,
      conversationId,
      activeProjectId,
      model,
      planFirst,
      webSearch,
      skillPacks,
      setSkillPacks,
      queryClient,
      navigate,
      fail,
    ],
  );

  const stop = useCallback(async () => {
    if (!live) return;
    try {
      await api.cancelRun(live.runId);
    } catch (error) {
      fail(error, `${copy.chat.stopFailed} ${apiErrorMessage(error, online)}`);
    }
  }, [live, fail, online]);

  /**
   * Mengarahkan run coding yang sedang berjalan dengan isi kolom pesan. Teks dikosongkan lebih dulu
   * dan dikembalikan bila gagal, supaya pengetikan berikutnya tidak menunggu jaringan.
   */
  const steer = useCallback(
    async (mode: 'steer' | 'followUp') => {
      const text = draft.trim();
      if (!live || !codingLive || !text) return;
      if (!online) {
        push(copy.chat.offlineSend, 'danger');
        return;
      }
      setDraft('');
      try {
        await api.steerRun(live.runId, text, mode);
        push(mode === 'followUp' ? copy.chat.steer.queued : copy.chat.steer.sent);
      } catch (error) {
        setDraft((current) => current || text);
        fail(error, `${copy.chat.steer.failed} ${apiErrorMessage(error, online)}`);
      }
    },
    [draft, live, codingLive, online, push, fail],
  );

  const lastUser = [...messages].reverse().find((m) => m.author === 'user');

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

  /** Menarik arahan dari antrean agent; daftar menyusut lewat event `queue.updated`. */
  const removeQueued = useCallback(
    async (queue: QueueName, text: string) => {
      if (!live) return;
      try {
        await api.removeQueued(live.runId, queue, text);
      } catch (error) {
        fail(error, `${copy.chat.queue.removeFailed} ${apiErrorMessage(error, online)}`);
      }
    },
    [live, fail, online],
  );

  /** Jawaban atas pertanyaan agent; panel hilang lewat event `question.resolved`, bukan dari sini. */
  const answerQuestion = useCallback(
    async (questionId: string, result: { answers: QuestionAnswer[]; cancelled: boolean }) => {
      if (!live) return;
      setResolving((current) => new Set(current).add(questionId));
      try {
        await api.answerQuestion(live.runId, questionId, result);
      } catch (error) {
        fail(error, `${copy.question.failed} ${apiErrorMessage(error, online)}`);
      } finally {
        setResolving((current) => {
          const next = new Set(current);
          next.delete(questionId);
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

  /** Mengirim ulang teks pesan terakhir sebagai pesan baru (sama seperti Android). */
  const resendLast = useCallback(() => {
    if (!lastUser || sending || streaming) return;
    void send(messageText(lastUser));
  }, [lastUser, sending, streaming, send]);

  /** Pesan yang dibuang server juga dibuang dari cache, dan tampilan run-nya dilupakan. */
  const dropFrom = useCallback(
    (conversation: string, messageId: string) => {
      for (const runId of truncateCache(queryClient, conversation, messageId)) runs.forget(runId);
      setActiveRunId(null);
    },
    [queryClient],
  );

  /**
   * Mengubah pesan pengguna mana pun: pesan itu dan semua sesudahnya dibuang, lalu teks baru dikirim. Agent
   * memulai sesi baru dengan riwayat sisanya, jadi bagian yang dibuang tidak diingat. true bila berhasil.
   */
  const editMessage = useCallback(
    async (messageId: string, text: string): Promise<boolean> => {
      const body = text.trim();
      if (!conversationId || !body || sending || streaming) return false;
      if (!online) {
        push(copy.chat.offlineSend, 'danger');
        return false;
      }
      setSending(true);
      try {
        // Lampiran pesan asli ikut terkirim lagi; yang diubah hanya teksnya.
        const original = messages.find((m) => m.id === messageId);
        const response = await api.editMessage(messageId, {
          text: body,
          files: original?.parts.flatMap((part) => (part.type === 'file' ? [part] : [])),
          model: model ?? undefined,
        });
        dropFrom(conversationId, messageId);
        addMessageToCache(queryClient, conversationId, response.message);
        runs.track(response.run.id, response.run.conversationId ?? undefined);
        setActiveRunId(response.run.id);
        return true;
      } catch (error) {
        fail(error, `${copy.chat.editFailed} ${apiErrorMessage(error, online)}`);
        return false;
      } finally {
        setSending(false);
      }
    },
    [
      conversationId,
      messages,
      sending,
      streaming,
      online,
      push,
      model,
      dropFrom,
      queryClient,
      fail,
    ],
  );

  /** Menghapus pesan beserta semua sesudahnya. true bila berhasil. */
  const deleteMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!conversationId || sending || streaming) return false;
      try {
        await api.deleteMessage(messageId);
        dropFrom(conversationId, messageId);
        void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
        return true;
      } catch (error) {
        fail(error, `${copy.chat.deleteMessageFailed} ${apiErrorMessage(error, online)}`);
        return false;
      }
    },
    [conversationId, sending, streaming, dropFrom, queryClient, fail, online],
  );

  /** Cabangkan percakapan dari jawaban ini lalu pindah ke cabangnya. */
  const forkMessage = useCallback(
    async (messageId: string) => {
      try {
        const created = await api.forkConversation(messageId);
        await queryClient.invalidateQueries({ queryKey: ['conversations'] });
        await goConversation(navigate, created);
        push(copy.chat.forkDone);
      } catch (error) {
        fail(error);
      }
    },
    [queryClient, navigate, push, fail],
  );

  const loadOlder = useCallback(() => void messagesQuery.fetchNextPage(), [messagesQuery]);

  return {
    messages,
    live,
    finished,
    failure: failure ? failure.message : null,
    pending,
    draft,
    setDraft,
    model,
    setModel,
    models: modelsQuery.data ?? [],
    roles,
    approvals: live?.approvals ?? [],
    reviewRunId,
    attachments,
    removeAttachment,
    files: attach.files,
    addFiles: attach.add,
    removeFile: attach.remove,
    uploading: attach.uploading,
    hasReadyFiles: attach.parts.length > 0,
    resolvingApprovals: resolving,
    resolveApproval: (approvalId: string, decision: 'allow' | 'deny', remember: boolean) =>
      void resolveApproval(approvalId, decision, remember),
    answerQuestion: (
      questionId: string,
      result: { answers: QuestionAnswer[]; cancelled: boolean },
    ) => void answerQuestion(questionId, result),
    sending,
    removeQueued: (queue: QueueName, text: string) => void removeQueued(queue, text),
    streaming,
    send: () => void send(),
    stop: () => void stop(),
    /** Hanya run coding (omp) yang bisa diarahkan di tengah jalan; chat umum (Hermes) tidak. */
    canSteer: codingLive,
    steer: (mode: 'steer' | 'followUp') => void steer(mode),
    editLast,
    /** Mengirim teks tertentu (saran lanjutan) tanpa menyentuh draf. */
    sendText: (text: string) => void send(text),
    sendRichFollowUp: (followUp: RichAnswerFollowUp) => void send(undefined, { followUp }),
    resendLast,
    canEditLast: lastUser !== undefined && !sending && !streaming,
    editableUserId: lastUser && !sending && !streaming ? lastUser.id : null,
    canModify: !sending && !streaming,
    editMessage,
    deleteMessage,
    forkMessage: (messageId: string) => void forkMessage(messageId),
    focusNonce,
    planFirst,
    setPlanFirst,
    webSearch,
    setWebSearch,
    skillPacks,
    setSkillPacks,
    awaitingPlanApproval,
    /** Menyetujui rencana: pesan berikutnya dikerjakan sungguhan (tanpa mode rencana). */
    approvePlan: () => {
      setPlanFirst(false);
      void send(copy.chat.plan.approvalMessage, { plan: false });
    },
    /** Chat di dalam project (sambutan dan saran mengarah ke coding). */
    inProject: activeProjectId !== null,
    /** Mengisi kolom pesan dari kartu saran lalu memindahkan fokus ke sana (belum dikirim). */
    prefill: (text: string) => {
      setDraft(text);
      setFocusNonce((n) => n + 1);
    },
    loadOlder,
    hasMore: messagesQuery.hasNextPage,
    loadingOlder: messagesQuery.isFetchingNextPage,
    status: messagesQuery,
    online,
  };
}
