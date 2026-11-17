import {
  CONNECTOR_TOKEN_MAX,
  CONNECTOR_URL_MAX,
  type McpConnectorProbe,
  type McpConnectorTool,
} from '@aios/contracts';
import { useState, type FormEvent } from 'react';
import { api } from '../app/services';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { connectorErrorMessage } from './connectorErrors';
import { useConnectorActions } from './useConnectorActions';

const t = copy.connectorsPage.add;

/**
 * Tambah konektor: periksa server dulu (`probe`), pemilik mencentang tool yang boleh dipakai, lalu simpan.
 * Yang tersimpan adalah persis daftar tool yang dilihat pemilik saat memeriksa.
 */
export function AddConnectorTab() {
  const { busy, run, online } = useConnectorActions();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [probe, setProbe] = useState<McpConnectorProbe | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function check(event?: FormEvent) {
    event?.preventDefault();
    const value = url.trim();
    if (!value || busy) return;
    setError(null);
    setProbe(null);
    setPicked([]);
    const data = await run(
      'probe',
      () => api.probeMcpConnector(value, token.trim() || undefined),
      undefined,
      (err) => {
        setError(connectorErrorMessage(err, online));
        return true;
      },
    );
    if (data) {
      setProbe(data);
      setPicked(data.tools.map((tool) => tool.name));
    }
  }

  async function save() {
    if (!probe) return;
    const tools = probe.tools.filter((tool) => picked.includes(tool.name));
    if (tools.length === 0) {
      setError(t.needTool);
      return;
    }
    setError(null);
    const saved = await run(
      'save',
      () =>
        api.createMcpConnector({
          name: name.trim(),
          displayName: displayName.trim(),
          url: url.trim(),
          ...(token.trim() ? { token: token.trim() } : {}),
          tools,
        }),
      t.saved,
      (err) => {
        setError(connectorErrorMessage(err, online));
        return true;
      },
    );
    if (saved) {
      setProbe(null);
      setPicked([]);
      setName('');
      setDisplayName('');
      setUrl('');
      setToken('');
    }
  }

  const canProbe = online && url.trim() !== '' && busy === null;
  const canSave =
    online && busy === null && name.trim() !== '' && displayName.trim() !== '' && picked.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-ui text-text-2">{t.intro}</p>
      <form onSubmit={(ev) => void check(ev)} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label={t.name}
              hint={t.nameHint}
              placeholder={t.namePlaceholder}
              value={name}
              maxLength={24}
              onChange={(ev) => setName(ev.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <TextField
              label={t.displayName}
              placeholder={t.displayNamePlaceholder}
              value={displayName}
              maxLength={80}
              onChange={(ev) => setDisplayName(ev.target.value)}
            />
          </div>
        </div>
        <TextField
          label={t.url}
          hint={t.urlHint}
          placeholder={t.urlPlaceholder}
          value={url}
          maxLength={CONNECTOR_URL_MAX}
          onChange={(ev) => setUrl(ev.target.value)}
        />
        <TextField
          label={t.token}
          hint={t.tokenHint}
          type="password"
          value={token}
          maxLength={CONNECTOR_TOKEN_MAX}
          onChange={(ev) => setToken(ev.target.value)}
        />
        <div>
          <Button type="submit" variant="primary" disabled={!canProbe}>
            {busy === 'probe' ? t.probing : t.probe}
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      ) : null}
      {probe ? (
        <PreviewCard
          probe={probe}
          picked={picked}
          onToggle={(toolName, on) =>
            setPicked((prev) =>
              on ? [...prev, toolName] : prev.filter((item) => item !== toolName),
            )
          }
          busy={busy === 'save'}
          disabled={!canSave}
          onSave={() => void save()}
        />
      ) : null}
    </div>
  );
}

function PreviewCard({
  probe,
  picked,
  onToggle,
  busy,
  disabled,
  onSave,
}: {
  probe: McpConnectorProbe;
  picked: readonly string[];
  onToggle: (tool: string, on: boolean) => void;
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <section
      aria-label={t.previewTitle}
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-ui font-medium text-text">{t.previewTitle}</h3>
        <span className="text-caption text-text-3">
          {t.server(probe.serverName, probe.serverVersion)}
        </span>
        <span className="text-caption text-text-3">{t.protocol(probe.protocolVersion)}</span>
      </div>
      {probe.truncated ? <p className="text-meta text-text-2">{t.truncated}</p> : null}
      {probe.tools.length === 0 ? (
        <p className="text-meta text-text-2">{t.noTools}</p>
      ) : (
        <ul aria-label={t.toolsLabel} className="flex flex-col gap-2">
          {probe.tools.map((tool) => (
            <ToolRow
              key={tool.name}
              tool={tool}
              checked={picked.includes(tool.name)}
              onToggle={(on) => onToggle(tool.name, on)}
            />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={disabled} onClick={onSave}>
          {busy ? t.saving : t.save}
        </Button>
        <span className="text-caption text-text-3">{t.selected(picked.length)}</span>
      </div>
    </section>
  );
}

function ToolRow({
  tool,
  checked,
  onToggle,
}: {
  tool: McpConnectorTool;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <input
        type="checkbox"
        id={`tool-${tool.name}`}
        checked={checked}
        onChange={(ev) => onToggle(ev.target.checked)}
        className="mt-1 accent-accent"
      />
      <label htmlFor={`tool-${tool.name}`} className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-ui text-text">{tool.title ?? tool.name}</span>
          <span className="rounded-badge bg-surface-2 px-1.5 py-0.5 text-caption text-text-2">
            {tool.readOnly ? t.read : t.write}
          </span>
        </span>
        <span className="text-caption text-text-3">{tool.description}</span>
        {tool.readOnly ? null : <span className="text-caption text-text-2">{t.writeWarning}</span>}
      </label>
    </li>
  );
}
