import { ChevronDown, ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copy } from '../copy';
import { api } from '../app/services';
import type { Activity } from '../realtime/activity';
import type { LiveArtifact } from '../realtime/liveRun';
import { AgentOrb, orbStateOf } from './AgentOrb';

export interface RunActivityProps {
  activity: Activity;
  now: number;
  onApproval?: () => void;
  output?: string | undefined;
  artifacts?: LiveArtifact[];
}

function ArtifactPreviews({ artifacts }: { artifacts: LiveArtifact[] }) {
  const [selected, setSelected] = useState<LiveArtifact | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void Promise.all(artifacts.slice(0, 4).filter((file) => /^image\/(png|jpeg|webp|gif)$/i.test(file.mime)).map(async (file) => {
      try {
        const next = URL.createObjectURL(await api.downloadFile(file.fileId));
        urls.push(next);
        if (alive) setThumbs((current) => ({ ...current, [file.fileId]: next }));
      } catch { /* full preview reports the actionable error */ }
    }));
    return () => { alive = false; urls.forEach((next) => URL.revokeObjectURL(next)); };
  }, [artifacts]);
  const [failed, setFailed] = useState(false);
  async function open(file: LiveArtifact) {
    setSelected(file); setUrl(null); setFailed(false);
    try {
      const blob = await api.downloadFile(file.fileId);
      setUrl(URL.createObjectURL(blob));
    } catch { setFailed(true); }
  }
  return <>
    <div className="flex gap-2">
      {artifacts.slice(0, 4).map((file) => (
        <button key={file.fileId} type="button" aria-label={`Preview: ${file.name}`} onClick={() => void open(file)} className="size-14 overflow-hidden rounded-control border border-border">
          {thumbs[file.fileId] ? <img src={thumbs[file.fileId]} alt="" className="size-full object-cover" /> : <span className="p-1 text-meta text-text-3">{file.name}</span>}
          <span className="sr-only">{file.name}</span>
        </button>
      ))}
      {artifacts.length > 4 ? <span>{`+${artifacts.length - 4}`}</span> : null}
    </div>
    {selected ? <div role="dialog" aria-modal="true" aria-label={selected.name} className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 p-6" onKeyDown={(e) => { if (e.key === 'Escape') setSelected(null); }}>
      <button autoFocus aria-label="Close preview" onClick={() => setSelected(null)}><X /></button>
      {failed ? <p role="alert">Preview unavailable</p> : url ? (/^image\/(png|jpeg|webp|gif)$/i.test(selected.mime) ? <img src={url} alt={selected.name} className="max-h-[80vh] max-w-full" /> : <p>Text preview available for {selected.name}</p>) : <p role="status">Loading preview…</p>}
    </div> : null}
  </>;
}

const ui = copy.runActivity.ui;

export function RunActivity({ activity, onApproval, output, artifacts = [] }: RunActivityProps) {
  const [open, setOpen] = useState(activity.needsAttention);
  const toggle = () => setOpen((value) => !value);
  return (
    <section className={`aios-run-activity aios-run-activity-${activity.phase}`} aria-live="polite">
      <button type="button" aria-label={ui.toggle} aria-expanded={open} onClick={toggle} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } }} className="flex min-h-11 w-full items-center gap-2 rounded-control border border-border bg-surface-2 px-3 text-left">
        <AgentOrb state={orbStateOf(activity.phase)} size={16} />
        <span className="min-w-0 flex-1 text-ui text-text">{activity.current?.label ?? activity.headline ?? ui.phase[activity.phase]}{activity.current?.target ? <span className="ml-2 text-text-3">{activity.current.target}</span> : null}</span>
        <span className="shrink-0 text-meta text-text-3">{Math.round(activity.elapsedMs / 1000)} {copy.runActivity.units.second}</span>
        <ChevronDown size={14} aria-hidden="true" className={open ? 'rotate-180' : ''} />
      </button>
      {activity.summary ? <p className="sr-only">{activity.summary}</p> : null}
      {artifacts.length > 0 && !open ? <ArtifactPreviews artifacts={artifacts} /> : null}
      {open ? <div className="flex flex-col gap-2 border-x border-b border-border px-3 py-2">
        {artifacts.length > 0 ? <ArtifactPreviews artifacts={artifacts} /> : null}
        {output ? <p className="truncate font-mono text-meta text-text-2" aria-label={ui.toolOutput}>{output}</p> : null}
        {activity.hiddenCount > 0 ? <p className="text-meta text-text-3">{ui.moreSteps(activity.hiddenCount)}</p> : null}
        {activity.summary && !['done', 'error', 'cancelled'].includes(activity.phase) ? <p className="text-ui font-medium text-text">{activity.summary}</p> : null}
        {activity.phase === 'waiting_approval' ? <button type="button" onClick={onApproval} className="inline-flex min-h-11 items-center gap-2 self-start text-ui text-warning underline">{ui.openApproval} <ExternalLink size={14} aria-hidden="true" /></button> : null}
      </div> : null}
    </section>
  );
}
