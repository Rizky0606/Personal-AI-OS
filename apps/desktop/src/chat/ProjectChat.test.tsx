import { workerBranchFor, type Project } from '@aios/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { CONV, TS, message, models, roles, run, uid } from '../test/fixtures';
import { api, emit, resetApi, runs } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ChatScreen } = await import('./ChatScreen');
const { StatusBar } = await import('../shell/StatusBar');

const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const APPROVAL = '0192f0c4-7a1b-7c2d-a003-4a5b6c7d8e93';
const APPROVAL_2 = '0192f0c4-7a1b-7c2d-a004-4a5b6c7d8e94';
const WORKER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

const project: Project = {
  id: PROJECT,
  name: 'Toko Online',
  workerDeviceId: WORKER,
  stack: { languages: ['typescript'], frameworks: [] },
  defaultBranch: 'main',
  createdAt: TS,
  updatedAt: TS,
};

// ID run unik per tes: controller mengingat run yang sudah diperiksa (satu proses, satu Set).
let RUN_X = '';
const page = (...items: ReturnType<typeof message>[]) => ({ items, nextBefore: null });
const field = () => screen.getByRole('textbox', { name: copy.chat.composerLabel });

beforeEach(() => {
  RUN_X = uid();
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listRoles.mockResolvedValue(roles);
  api.listModels.mockResolvedValue(models);
  api.listProjects.mockResolvedValue([project]);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => runs.release(RUN_X));

describe('chat per project', () => {
  it('chat umum maupun project tidak menawarkan pilihan role: router yang memutuskan', async () => {
    const view = await renderScreen(<ChatScreen />);
    await screen.findByRole('button', { name: new RegExp(`${copy.chat.model.label}:`) });
    expect(
      screen.queryByRole('button', { name: new RegExp(`^${copy.chat.role.label}:`) }),
    ).not.toBeInTheDocument();
    view.unmount();

    useUiStore.getState().setActiveProject(PROJECT);
    await renderScreen(<ChatScreen />);
    await screen.findByRole('button', { name: new RegExp(`${copy.chat.model.label}:`) });
    expect(
      screen.queryByRole('button', { name: new RegExp(`^${copy.chat.role.label}:`) }),
    ).not.toBeInTheDocument();
    // Sambutan chat project mengarah ke pekerjaan coding.
    expect(
      screen.getByRole('heading', { name: copy.chat.welcome.project.title }),
    ).toBeInTheDocument();
  });

  it('pesan pertama di project membuat percakapan terikat project', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    api.createConversation.mockResolvedValue({
      id: CONV,
      title: '',
      surface: 'windows',
      projectId: PROJECT,
      spaceId: null,
      pinned: false,
      archivedAt: null,
      createdAt: TS,
      updatedAt: TS,
    });
    api.sendMessage.mockResolvedValue({
      message: message({ author: 'user', text: 'x', runId: RUN_X }),
      run: run({ id: RUN_X }),
    });
    const user = userEvent.setup();
    const { router } = await renderScreen(<ChatScreen />);

    await user.type(field(), 'tambahkan tes{Enter}');

    expect(api.createConversation).toHaveBeenCalledWith('windows', PROJECT);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${CONV}`));
  });

  it('chat umum membuat percakapan tanpa project', async () => {
    api.createConversation.mockResolvedValue({
      id: CONV,
      title: '',
      surface: 'windows',
      projectId: null,
      spaceId: null,
      pinned: false,
      archivedAt: null,
      createdAt: TS,
      updatedAt: TS,
    });
    api.sendMessage.mockResolvedValue({
      message: message({ author: 'user', text: 'x', runId: RUN_X }),
      run: run({ id: RUN_X }),
    });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen />);

    await user.type(field(), 'halo{Enter}');

    expect(api.createConversation).toHaveBeenCalledWith('windows', undefined);
  });
});

describe('lampiran konteks dari preview', () => {
  it('elemen terpilih dikirim bersama pesan lalu lampiran dikosongkan; chip tampil di composer', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    useUiStore.getState().addAttachment({
      id: 'a1',
      label: 'button.simpan',
      text: '[Elemen dipilih dari preview]\nSelector: button.simpan',
    });
    api.createConversation.mockResolvedValue({
      id: CONV,
      title: '',
      surface: 'windows',
      projectId: PROJECT,
      spaceId: null,
      pinned: false,
      archivedAt: null,
      createdAt: TS,
      updatedAt: TS,
    });
    api.sendMessage.mockResolvedValue({
      message: message({ author: 'user', text: 'x', runId: RUN_X }),
      run: run({ id: RUN_X }),
    });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen />);
    expect(await screen.findByText('button.simpan')).toBeInTheDocument();

    await user.type(field(), 'perbaiki tombol ini{Enter}');

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    const sent = api.sendMessage.mock.calls[0]?.[1];
    expect(sent?.text).toBe(
      'perbaiki tombol ini\n\n[Elemen dipilih dari preview]\nSelector: button.simpan',
    );
    await waitFor(() => expect(useUiStore.getState().attachments).toEqual([]));
  });
});

describe('panel izin inline', () => {
  async function runWithApproval(extra: () => void = () => undefined) {
    useUiStore.getState().setActiveProject(PROJECT);
    api.listMessages.mockResolvedValue(
      page(message({ author: 'user', text: 'tambahkan tes', runId: RUN_X })),
    );
    api.getRun.mockResolvedValue(run({ id: RUN_X, status: 'running' }));
    const view = await renderScreen(<ChatScreen conversationId={CONV} />);
    await waitFor(() => expect(runs.get(RUN_X)).toBeDefined());
    act(() => {
      emit(`run:${RUN_X}`, {
        type: 'route.decided',
        role: 'frontend',
        confidence: 0.9,
        reason: 'x',
      });
      emit(`run:${RUN_X}`, { type: 'run.status', status: 'waiting_approval' });
      emit(`run:${RUN_X}`, {
        type: 'tool.started',
        toolCallId: 'c1',
        name: 'bash',
        target: 'node --test',
      });
      emit(`run:${RUN_X}`, {
        type: 'approval.requested',
        approvalId: APPROVAL,
        kind: 'command',
        detail: 'node --test',
        cwd: 'C:\\work\\aplikasi',
        toolCallId: 'c1',
      });
      extra();
    });
    return view;
  }

  it('menampilkan perintah persis, folder kerja, dan tiga pilihan; Izinkan sekali tanpa menyimpan aturan', async () => {
    api.resolveApproval.mockResolvedValue({} as never);
    const user = userEvent.setup();
    await runWithApproval();

    const panel = await screen.findByRole('group', { name: copy.approval.title.command });
    expect(within(panel).getByText('node --test')).toBeInTheDocument();
    expect(within(panel).getByText(/C:\\work\\aplikasi/)).toBeInTheDocument();
    expect(
      within(panel)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([copy.approval.allowOnce, copy.approval.allowAlways, copy.approval.deny]);

    await user.click(within(panel).getByRole('button', { name: copy.approval.allowOnce }));

    expect(api.resolveApproval).toHaveBeenCalledWith(RUN_X, APPROVAL, {
      decision: 'allow',
      remember: false,
    });
  });

  it('"Selalu untuk project ini" mengirim remember=true; Tolak mengirim deny', async () => {
    api.resolveApproval.mockResolvedValue({} as never);
    const user = userEvent.setup();
    await runWithApproval();
    const panel = await screen.findByRole('group', { name: copy.approval.title.command });

    await user.click(within(panel).getByRole('button', { name: copy.approval.allowAlways }));
    expect(api.resolveApproval).toHaveBeenLastCalledWith(RUN_X, APPROVAL, {
      decision: 'allow',
      remember: true,
    });

    await user.click(within(panel).getByRole('button', { name: copy.approval.deny }));
    expect(api.resolveApproval).toHaveBeenLastCalledWith(RUN_X, APPROVAL, {
      decision: 'deny',
      remember: false,
    });
  });

  it('tombol dinonaktifkan selama keputusan dikirim; panel hilang setelah event approval.resolved', async () => {
    let finish: () => void = () => undefined;
    api.resolveApproval.mockReturnValue(new Promise((r) => (finish = () => r({} as never))));
    const user = userEvent.setup();
    await runWithApproval();
    const panel = await screen.findByRole('group', { name: copy.approval.title.command });

    await user.click(within(panel).getByRole('button', { name: copy.approval.allowOnce }));
    expect(within(panel).getByRole('button', { name: copy.approval.allowOnce })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: copy.approval.deny })).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: copy.approval.allowOnce }));
    expect(api.resolveApproval).toHaveBeenCalledTimes(1);
    finish();
    act(() =>
      emit(`run:${RUN_X}`, {
        type: 'approval.resolved',
        approvalId: APPROVAL,
        decision: 'allow',
        remember: false,
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: copy.approval.title.command }),
      ).not.toBeInTheDocument(),
    );
  });

  it('gagal mengirim keputusan: toast dengan langkah berikutnya dan panel tetap ada', async () => {
    api.resolveApproval.mockRejectedValue(new ApiProblem(503, 'worker_offline', 'x'));
    const user = userEvent.setup();
    await runWithApproval();
    const panel = await screen.findByRole('group', { name: copy.approval.title.command });

    await user.click(within(panel).getByRole('button', { name: copy.approval.allowOnce }));

    expect(await screen.findByText(new RegExp(copy.approval.failed))).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: copy.approval.allowOnce })).toBeEnabled();
  });

  it('dua permintaan sekaligus tampil sebagai dua panel terpisah', async () => {
    await runWithApproval(() =>
      emit(`run:${RUN_X}`, {
        type: 'approval.requested',
        approvalId: APPROVAL_2,
        kind: 'file_write',
        detail: 'Path: math.test.js',
      }),
    );

    expect(
      await screen.findByRole('group', { name: copy.approval.title.command }),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: copy.approval.title.file_write })).toBeInTheDocument();
  });

  it('permintaan izin ikut terlihat setelah aplikasi dibuka ulang (event diputar ulang dari seq 0)', async () => {
    await runWithApproval();

    // Pelacak baru (pengguna membuka ulang) membangun ulang dari event yang sama.
    runs.release(RUN_X);
    runs.track(RUN_X);
    act(() => {
      emit(`run:${RUN_X}`, {
        type: 'approval.requested',
        approvalId: APPROVAL,
        kind: 'command',
        detail: 'node --test',
      });
    });

    expect(
      await screen.findByRole('group', { name: copy.approval.title.command }),
    ).toBeInTheDocument();
  });
});

describe('status bar: project dan branch', () => {
  it('menampilkan project dan branch bawaan; saat run coding berjalan, branch kerja agent', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    api.listMessages.mockResolvedValue(
      page(message({ author: 'user', text: 'tambahkan tes', runId: RUN_X })),
    );
    api.getRun.mockResolvedValue(run({ id: RUN_X, status: 'running' }));
    await renderScreen(
      <>
        <ChatScreen conversationId={CONV} />
        <StatusBar />
      </>,
    );
    expect(await screen.findByText('Toko Online · main')).toBeInTheDocument();
    await waitFor(() => expect(runs.get(RUN_X)).toBeDefined());

    act(() => {
      emit(`run:${RUN_X}`, {
        type: 'route.decided',
        role: 'frontend',
        confidence: 0.9,
        reason: 'x',
      });
      emit(`run:${RUN_X}`, { type: 'run.status', status: 'running' });
    });
    expect(await screen.findByText(`Toko Online · ${workerBranchFor(RUN_X)}`)).toBeInTheDocument();

    act(() => emit(`run:${RUN_X}`, { type: 'run.status', status: 'needs_review' }));
    expect(await screen.findByText('Toko Online · main')).toBeInTheDocument();
  });

  it('role Umum di dalam project tidak mengubah branch di status bar', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    api.listMessages.mockResolvedValue(
      page(message({ author: 'user', text: 'tulis catatan', runId: RUN_X })),
    );
    api.getRun.mockResolvedValue(run({ id: RUN_X, status: 'running' }));
    await renderScreen(
      <>
        <ChatScreen conversationId={CONV} />
        <StatusBar />
      </>,
    );
    await waitFor(() => expect(runs.get(RUN_X)).toBeDefined());

    act(() => {
      emit(`run:${RUN_X}`, { type: 'route.decided', role: 'writer', confidence: 0.9, reason: 'x' });
      emit(`run:${RUN_X}`, { type: 'run.status', status: 'running' });
    });

    expect(await screen.findByText('Toko Online · main')).toBeInTheDocument();
  });

  it('tanpa project aktif: Chat umum', async () => {
    await renderScreen(<StatusBar />);

    expect(await screen.findByText(copy.status.project)).toBeInTheDocument();
  });
});

describe('hasil run coding menunggu tinjauan', () => {
  const reviewRun = (status: 'needs_review' | 'completed') =>
    run({ id: RUN_X, status, kind: 'coding', engine: 'omp' });

  it('membuka percakapan lama: pengingat dengan tombol ke tab Diff; panel tidak dibuka paksa', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    api.listMessages.mockResolvedValue(
      page(message({ author: 'user', text: 'tes', runId: RUN_X })),
    );
    api.getRun.mockResolvedValue(reviewRun('needs_review'));
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    const open = await screen.findByRole('button', { name: copy.review.open });
    expect(screen.getByText(copy.review.ready)).toBeInTheDocument();
    expect(useUiStore.getState().reviewRunId).toBe(RUN_X);
    expect(useUiStore.getState().rightPanelOpen).toBe(false);

    await user.click(open);

    expect(useUiStore.getState()).toMatchObject({
      rightPanelOpen: true,
      rightPanelTab: 'diff',
      reviewRunId: RUN_X,
    });
  });

  it('run selesai di depan mata: panel Diff terbuka sendiri', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    api.listMessages.mockResolvedValue(
      page(message({ author: 'user', text: 'tes', runId: RUN_X })),
    );
    api.getRun.mockResolvedValue(run({ id: RUN_X, status: 'running' }));
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await waitFor(() => expect(runs.get(RUN_X)).toBeDefined());
    expect(useUiStore.getState().rightPanelOpen).toBe(false);

    act(() => {
      emit(`run:${RUN_X}`, { type: 'run.status', status: 'running' });
      emit(`run:${RUN_X}`, { type: 'run.status', status: 'needs_review' });
    });

    await waitFor(() =>
      expect(useUiStore.getState()).toMatchObject({
        rightPanelOpen: true,
        rightPanelTab: 'diff',
        reviewRunId: RUN_X,
      }),
    );
    expect(await screen.findByRole('button', { name: copy.review.open })).toBeInTheDocument();
  });

  it('run biasa (completed) tidak menampilkan pengingat; meninggalkan percakapan membersihkan tab Diff', async () => {
    api.listMessages.mockResolvedValue(
      page(message({ author: 'user', text: 'tes', runId: RUN_X })),
    );
    api.getRun.mockResolvedValue(reviewRun('completed'));
    const view = await renderScreen(<ChatScreen conversationId={CONV} />);
    await waitFor(() => expect(api.getRun).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: copy.review.open })).toBeNull();
    expect(useUiStore.getState().reviewRunId).toBeNull();
    view.unmount();

    api.getRun.mockResolvedValue(reviewRun('needs_review'));
    const again = await renderScreen(<ChatScreen conversationId={CONV} />);
    await screen.findByRole('button', { name: copy.review.open });
    expect(useUiStore.getState().reviewRunId).toBe(RUN_X);
    again.unmount();

    expect(useUiStore.getState().reviewRunId).toBeNull();
  });
});
