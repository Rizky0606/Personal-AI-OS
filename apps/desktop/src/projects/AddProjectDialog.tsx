import type { ProjectInspection } from '@aios/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api, workerApi } from '../app/services';
import { copy } from '../copy';
import { pickFolder } from '../lib/pickFolder';
import { DialogFrame } from '../screens/DialogFrame';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { RadioMenu } from '../ui/RadioMenu';
import { TextField } from '../ui/TextField';
import { useToastStore } from '../ui/Toaster';
import { workerErrorMessage } from '../worker/errors';
import { useWorker } from '../worker/hooks';
import { WorkerCallError } from '../worker/localClient';
import { StackChips } from './StackChips';

export interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Working = 'inspect' | 'allow' | 'register' | null;

/**
 * Pilih folder lewat dialog sistem, periksa (stack, git, branch bawaan), lalu daftarkan: metadata ke gateway,
 * path hanya diikat di worker lokal. Folder di luar daftar izin ditawari untuk diizinkan secara eksplisit.
 */
export function AddProjectDialog({ open, onOpenChange }: AddProjectDialogProps) {
  const worker = useWorker();
  const online = useOnline();
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockedPath, setBlockedPath] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; branch?: string }>({});
  const [working, setWorking] = useState<Working>(null);

  function reset() {
    setInspection(null);
    setName('');
    setBranch('');
    setError(null);
    setBlockedPath(null);
    setFieldErrors({});
    setWorking(null);
  }

  function change(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  // Repo dengan branch lokal: pilih dari daftar (branch bawaan di atas). Bukan repo: ketik manual.
  const branchChoices = inspection?.git.isRepo
    ? [
        ...new Set([
          ...(inspection.git.defaultBranch ? [inspection.git.defaultBranch] : []),
          ...inspection.git.branches,
        ]),
      ]
    : [];

  async function inspect(path: string) {
    setError(null);
    setBlockedPath(null);
    setWorking('inspect');
    try {
      const result = await workerApi.inspect(path);
      setInspection(result);
      setName(result.name);
      setBranch(result.git.defaultBranch ?? 'main');
    } catch (e) {
      if (e instanceof WorkerCallError && e.code === 'path_not_allowed') setBlockedPath(path);
      setError(workerErrorMessage(e));
    } finally {
      setWorking(null);
    }
  }

  async function choose() {
    const path = await pickFolder(copy.projects.dialog.pickTitle);
    if (path) await inspect(path);
  }

  async function allow() {
    if (!blockedPath) return;
    const path = blockedPath;
    setWorking('allow');
    try {
      await workerApi.addFolder(path);
      await queryClient.invalidateQueries({ queryKey: ['worker'] });
    } catch (e) {
      setError(workerErrorMessage(e));
      setWorking(null);
      return;
    }
    await inspect(path);
  }

  async function register() {
    if (!inspection || working) return;
    const errors: { name?: string; branch?: string } = {};
    if (!name.trim()) errors.name = copy.projects.dialog.emptyName;
    if (!branch.trim()) errors.branch = copy.projects.dialog.emptyBranch;
    setFieldErrors(errors);
    if (errors.name || errors.branch) return;
    const deviceId = worker.status?.deviceId;
    if (!deviceId) {
      setError(copy.workerErrors.not_connected);
      return;
    }

    setError(null);
    setWorking('register');
    let created;
    try {
      created = await api.createProject({
        name: name.trim(),
        workerDeviceId: deviceId,
        stack: inspection.stack,
        defaultBranch: branch.trim(),
      });
    } catch (e) {
      setError(apiErrorMessage(e, online));
      setWorking(null);
      return;
    }
    try {
      await workerApi.bind(created.id, inspection.path);
      push(copy.projects.dialog.registered);
    } catch {
      push(copy.projects.dialog.bindFailed, 'danger');
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['worker'] }),
    ]);
    change(false);
  }

  const d = copy.projects.dialog;
  return (
    <DialogFrame
      open={open}
      onOpenChange={change}
      title={d.title}
      description={d.intro}
      closeLabel={d.close}
      footer={
        inspection === null ? undefined : (
          <>
            <Button
              variant="secondary"
              disabled={working !== null}
              onClick={() => {
                setInspection(null);
                setError(null);
              }}
            >
              {d.change}
            </Button>
            <Button variant="primary" disabled={working !== null} onClick={() => void register()}>
              {working === 'register' ? d.registering : d.register}
            </Button>
          </>
        )
      }
    >
      {error ? (
        <ErrorBanner
          message={error}
          action={
            blockedPath ? (
              <Button variant="secondary" disabled={working !== null} onClick={() => void allow()}>
                {d.allow}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {blockedPath ? <p className="text-meta text-text-2">{d.allowHint}</p> : null}

      {inspection === null ? (
        <div className="flex items-center gap-3 pb-2">
          <Button
            variant="primary"
            disabled={working !== null || worker.local !== 'connected'}
            onClick={() => void choose()}
          >
            <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" />
            {d.pick}
          </Button>
          {working === 'inspect' ? (
            <span role="status" className="text-meta text-text-2">
              {d.inspecting}
            </span>
          ) : null}
        </div>
      ) : (
        <>
          <dl className="flex flex-col divide-y divide-border rounded-control border border-border">
            <div className="grid grid-cols-[6rem_1fr] gap-3 px-3 py-2 text-ui">
              <dt className="text-text-2">{d.folder}</dt>
              <dd className="min-w-0 font-mono break-all text-text">{inspection.path}</dd>
            </div>
            <div className="grid grid-cols-[6rem_1fr] gap-3 px-3 py-2 text-ui">
              <dt className="text-text-2">{d.stack}</dt>
              <dd>
                <StackChips stack={inspection.stack} />
              </dd>
            </div>
          </dl>
          {inspection.git.isRepo ? null : <ErrorBanner tone="warning" message={d.notRepo} />}
          <TextField
            label={d.name}
            value={name}
            error={fieldErrors.name}
            onChange={(e) => setName(e.target.value)}
          />
          {branchChoices.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-meta text-text-2">{d.branch}</span>
              <RadioMenu
                label={d.branchPick}
                value={branch}
                onValueChange={setBranch}
                options={branchChoices.map((b) => ({ value: b, label: b }))}
                trigger={
                  <button
                    type="button"
                    aria-label={`${d.branch}: ${branch}`}
                    className="flex h-8 w-full items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 font-mono text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
                  >
                    <span className="truncate">{branch}</span>
                    <ChevronDown
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden="true"
                      className="shrink-0 text-text-2"
                    />
                  </button>
                }
              />
              <span className="text-caption text-text-3">{d.branchHint}</span>
            </div>
          ) : (
            <TextField
              label={d.branch}
              value={branch}
              error={fieldErrors.branch}
              className="font-mono"
              onChange={(e) => setBranch(e.target.value)}
            />
          )}
        </>
      )}
    </DialogFrame>
  );
}
