import {
  SCHEDULE_PROPOSAL_NAME_MAX,
  SCHEDULE_PROPOSAL_PROMPT_MAX,
  TASK_PROPOSAL_BODY_MAX,
  TASK_PROPOSAL_TITLE_MAX,
  type AgentProposal,
} from '@aios/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useAgentProposals } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import { useAgentProposalActions, type AgentProposalActions } from './useAgentProposalActions';

type TaskItem = Extract<AgentProposal, { kind: 'task' }>;
type ScheduleItem = Extract<AgentProposal, { kind: 'schedule' }>;
type Target = ScheduleItem['schedule']['target'];

const a = copy.agentProposals;

/** Usulan kartu dari agent untuk satu project, di atas papan kanban. Tidak tampil bila tidak ada usulan. */
export function TaskProposals({ projectId }: { projectId: string }) {
  const query = useAgentProposals({ kind: 'task', projectId });
  const actions = useAgentProposalActions();
  const online = useOnline();
  const items = (query.data ?? []).filter((p): p is TaskItem => p.kind === 'task');

  return (
    <ProposalSection
      id="agent-task-proposals"
      title={a.task.title(items.length)}
      intro={a.task.intro}
      listLabel={a.task.list}
      query={query}
      online={online}
      count={items.length}
    >
      {items.map((proposal) => (
        <TaskRow
          key={proposal.id}
          proposal={proposal}
          actions={actions}
          disabled={!online || actions.busy !== null}
        />
      ))}
    </ProposalSection>
  );
}

/** Usulan jadwal dari agent, di atas daftar jadwal. Tidak tampil bila tidak ada usulan. */
export function ScheduleProposals() {
  const query = useAgentProposals({ kind: 'schedule' });
  const actions = useAgentProposalActions();
  const online = useOnline();
  const items = (query.data ?? []).filter((p): p is ScheduleItem => p.kind === 'schedule');

  return (
    <ProposalSection
      id="agent-schedule-proposals"
      title={a.schedule.title(items.length)}
      intro={a.schedule.intro}
      listLabel={a.schedule.list}
      query={query}
      online={online}
      count={items.length}
    >
      {items.map((proposal) => (
        <ScheduleRow
          key={proposal.id}
          proposal={proposal}
          actions={actions}
          disabled={!online || actions.busy !== null}
        />
      ))}
    </ProposalSection>
  );
}

function ProposalSection({
  id,
  title,
  intro,
  listLabel,
  query,
  online,
  count,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  listLabel: string;
  query: UseQueryResult<AgentProposal[]>;
  online: boolean;
  count: number;
  children: ReactNode;
}) {
  if (query.isError && !query.data) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-panel border border-border bg-surface p-4"
      >
        <p className="flex-1 text-ui text-text-2">
          {online ? a.loadError : apiErrorMessage(query.error, online)}
        </p>
        <Button variant="secondary" disabled={!online} onClick={() => void query.refetch()}>
          {copy.states.retry}
        </Button>
      </div>
    );
  }
  if (count === 0) return null;

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-ui font-semibold text-text">
          {title}
        </h2>
        <p className="text-meta text-text-2">{intro}</p>
      </div>
      <ul
        aria-label={listLabel}
        className="flex flex-col divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface"
      >
        {children}
      </ul>
    </section>
  );
}

/** Alasan, nama agent, dan peringatan web. Semua isi dari agent tampil sebagai teks biasa. */
function ProposalMeta({ proposal }: { proposal: AgentProposal }) {
  return (
    <>
      <p className="text-meta text-text-2 whitespace-pre-wrap">{a.reason(proposal.reason)}</p>
      <p className="text-meta text-text-3">{a.agents[proposal.agent]}</p>
      {proposal.afterWeb ? (
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
          {a.afterWeb}
        </p>
      ) : null}
    </>
  );
}

function RowError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-meta text-danger">
      {message}
    </p>
  ) : null;
}

function TaskRow({
  proposal,
  actions,
  disabled,
}: {
  proposal: TaskItem;
  actions: AgentProposalActions;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(proposal.task.title);
  const [body, setBody] = useState(proposal.task.body);
  const [error, setError] = useState<string | null>(null);

  async function approve(edited: boolean) {
    const result = await actions.approve(
      proposal,
      edited ? { task: { title: title.trim(), body: body.trim() } } : {},
    );
    setError(result);
    if (result === null) setEditing(false);
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      {editing ? (
        <>
          <TextField
            label={a.task.titleLabel}
            value={title}
            maxLength={TASK_PROPOSAL_TITLE_MAX}
            autoFocus
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextArea
            label={a.task.bodyLabel}
            value={body}
            rows={4}
            maxLength={TASK_PROPOSAL_BODY_MAX}
            disabled={disabled}
            onChange={(event) => setBody(event.target.value)}
          />
        </>
      ) : (
        <>
          <p className="text-ui font-medium text-text whitespace-pre-wrap">{proposal.task.title}</p>
          {proposal.task.body ? (
            <p className="line-clamp-3 text-meta text-text-2 whitespace-pre-wrap">
              {proposal.task.body}
            </p>
          ) : null}
        </>
      )}
      <ProposalMeta proposal={proposal} />
      <RowError message={error} />
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button variant="ghost" disabled={disabled} onClick={() => setEditing(false)}>
              {a.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={disabled || !title.trim()}
              onClick={() => void approve(true)}
            >
              {a.task.approve}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={disabled} onClick={() => void approve(false)}>
              {a.task.approve}
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                setTitle(proposal.task.title);
                setBody(proposal.task.body);
                setError(null);
                setEditing(true);
              }}
            >
              {a.task.editApprove}
            </Button>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => void actions.reject(proposal).then(setError)}
            >
              {a.reject}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function ScheduleRow({
  proposal,
  actions,
  disabled,
}: {
  proposal: ScheduleItem;
  actions: AgentProposalActions;
  disabled: boolean;
}) {
  const s = proposal.schedule;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [cron, setCron] = useState(s.cron);
  const [timezone, setTimezone] = useState(s.timezone);
  const [prompt, setPrompt] = useState(s.prompt);
  const [target, setTarget] = useState<Target>(s.target);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function approve(edited: boolean) {
    const result = await actions.approve(proposal, {
      schedule: edited
        ? {
            name: name.trim(),
            cron: cron.trim(),
            timezone: timezone.trim(),
            prompt: prompt.trim(),
            target,
            enabled,
          }
        : { enabled },
    });
    setError(result);
    if (result === null) setEditing(false);
  }

  const complete = !!(name.trim() && cron.trim() && timezone.trim() && prompt.trim());

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      {editing ? (
        <>
          <TextField
            label={a.schedule.nameLabel}
            value={name}
            maxLength={SCHEDULE_PROPOSAL_NAME_MAX}
            autoFocus
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label={a.schedule.cronLabel}
              value={cron}
              disabled={disabled}
              onChange={(event) => setCron(event.target.value)}
            />
            <TextField
              label={a.schedule.timezoneLabel}
              value={timezone}
              disabled={disabled}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </div>
          <div role="group" aria-label={a.schedule.targetLabel} className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-text-2">{a.schedule.targetLabel}</span>
            <div className="flex gap-2">
              {(['chat', 'research'] as const).map((value) => (
                <Button
                  key={value}
                  variant={target === value ? 'primary' : 'secondary'}
                  aria-pressed={target === value}
                  disabled={disabled}
                  onClick={() => setTarget(value)}
                >
                  {a.schedule.targets[value]}
                </Button>
              ))}
            </div>
          </div>
          <TextArea
            label={a.schedule.promptLabel}
            value={prompt}
            rows={4}
            maxLength={SCHEDULE_PROPOSAL_PROMPT_MAX}
            disabled={disabled}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </>
      ) : (
        <>
          <p className="text-ui font-medium text-text whitespace-pre-wrap">{s.name}</p>
          <p className="text-meta text-text-2">
            {a.schedule.when(proposal.description, s.cron, s.timezone)}
          </p>
          <p className="text-meta text-text-2">{a.schedule.target(a.schedule.targets[s.target])}</p>
          <p className="line-clamp-3 text-meta text-text-2 whitespace-pre-wrap">{s.prompt}</p>
        </>
      )}
      <ProposalMeta proposal={proposal} />
      <div className="flex items-center gap-2">
        <Switch
          checked={enabled}
          onChange={setEnabled}
          label={a.schedule.enable}
          disabled={disabled}
        />
        <span aria-hidden="true" className="text-meta text-text-2">
          {a.schedule.enable}
        </span>
      </div>
      <RowError message={error} />
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button variant="ghost" disabled={disabled} onClick={() => setEditing(false)}>
              {a.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={disabled || !complete}
              onClick={() => void approve(true)}
            >
              {a.schedule.approve}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={disabled} onClick={() => void approve(false)}>
              {a.schedule.approve}
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                setName(s.name);
                setCron(s.cron);
                setTimezone(s.timezone);
                setPrompt(s.prompt);
                setTarget(s.target);
                setError(null);
                setEditing(true);
              }}
            >
              {a.schedule.editApprove}
            </Button>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => void actions.reject(proposal).then(setError)}
            >
              {a.reject}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
