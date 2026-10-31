import type { RichAnswer, RichAnswerFollowUp, RichComponent } from '@aios/contracts';
import { useState } from 'react';
import { cn } from '../lib/cn';

const toneClass: Record<string, string> = {
  neutral: 'border-border bg-surface-2 text-text',
  info: 'border-info/40 bg-info/10 text-text',
  success: 'border-success/40 bg-success/10 text-text',
  warning: 'border-warning/40 bg-warning/10 text-text',
  danger: 'border-danger/40 bg-danger/10 text-text',
};

interface Props {
  value?: RichAnswer;
  blockId: string;
  readOnly: boolean;
  onFollowUp?: (value: RichAnswerFollowUp) => void;
}

const send = (
  props: Props,
  componentId: string,
  action: RichAnswerFollowUp['action'],
  value: RichAnswerFollowUp['value'],
) => {
  if (!props.readOnly) props.onFollowUp?.({ blockId: props.blockId, componentId, action, value });
};

function Chart({ component }: { component: Extract<RichComponent, { type: 'chart' }> }) {
  const width = 360;
  const height = 160;
  const pad = 28;
  const max = Math.max(...component.values, 1);
  const points = component.values.map((value, i) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(component.values.length - 1, 1);
    const y = height - pad - (value / max) * (height - pad * 2);
    return [x, y] as const;
  });
  const summary = `${component.label ?? component.chart}: ${component.values.map((v, i) => `${component.labels[i]} ${v}`).join(', ')}`;
  return (
    <figure className="flex min-w-0 flex-col gap-2" aria-label={summary}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        className="h-auto w-full overflow-visible"
      >
        <title>{component.label ?? component.chart}</title>
        <desc>{summary}</desc>
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          className="stroke-border-strong"
        />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="stroke-border-strong" />
        {component.labels.map((label, i) => (
          <text
            key={label + i}
            x={points[i]![0]}
            y={height - 8}
            textAnchor="middle"
            className="fill-text-2 text-caption"
          >
            {label}
          </text>
        ))}
        {component.chart === 'line' ? (
          <polyline
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            className="rich-chart-line stroke-info"
          />
        ) : (
          component.values.map((value, i) => {
            const barWidth = Math.max(8, (width - pad * 2) / component.values.length - 8);
            const x = pad + (i * (width - pad * 2)) / component.values.length + 4;
            const y = height - pad - (value / max) * (height - pad * 2);
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barWidth}
                height={height - pad - y}
                className="rich-chart-bar fill-info"
                rx="2"
              />
            );
          })
        )}
      </svg>
    </figure>
  );
}

function Component({ component, props }: { component: RichComponent; props: Props }) {
  switch (component.type) {
    case 'metric':
      return (
        <section
          className={cn('rounded-control border p-3', toneClass[component.tone ?? 'neutral'])}
        >
          <div className="text-meta text-text-2">{component.label}</div>
          <strong className="text-page">
            {component.value}
            {component.unit ? ` ${component.unit}` : ''}
          </strong>
          {component.trend ? (
            <div className="text-ui text-text-2">
              {component.trend.direction} {component.trend.value}
            </div>
          ) : null}
        </section>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-ui">
            <thead>
              <tr>
                {component.columns.map((column) => (
                  <th key={column} className="border-b border-border-strong px-2 py-1 text-left">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {component.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-b border-border px-2 py-1 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'chart':
      return <Chart component={component} />;
    case 'callout':
      return (
        <aside className={cn('rounded-control border p-3', toneClass[component.tone])}>
          <strong>{component.title}</strong>
          <p className="whitespace-pre-wrap break-words">{component.text}</p>
        </aside>
      );
    case 'kv':
      return (
        <dl className="grid gap-2 text-ui">
          {component.items.map((item) => (
            <div
              key={item.key}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 border-b border-border pb-1"
            >
              <dt className="font-semibold">{item.key}</dt>
              <dd className="break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'steps':
      return (
        <ol className="flex flex-col gap-2">
          {component.items.map((item, i) => (
            <li key={item.id} className="flex gap-2">
              <span className="text-text-2">{i + 1}.</span>
              <div>
                <strong>{item.title}</strong>
                <p className="whitespace-pre-wrap break-words text-text-2">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>
      );
    case 'checklist':
      return <Checklist component={component} props={props} />;
    case 'choices':
      return <Choices component={component} props={props} />;
    case 'slider':
      return (
        <label className="flex flex-col gap-2 text-ui">
          <span>
            {component.label}: {component.value}
          </span>
          <input
            type="range"
            min={component.min}
            max={component.max}
            step={component.step}
            defaultValue={component.value}
            disabled={props.readOnly}
            onChange={(e) => send(props, component.id, 'slider', Number(e.currentTarget.value))}
          />
        </label>
      );
  }
}

function Checklist({
  component,
  props,
}: {
  component: Extract<RichComponent, { type: 'checklist' }>;
  props: Props;
}) {
  const [checked, setChecked] = useState(
    () => new Set(component.items.filter((i) => i.checked).map((i) => i.id)),
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-semibold">{component.label}</legend>
      {component.items.map((item) => (
        <label key={item.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={checked.has(item.id)}
            disabled={props.readOnly}
            onChange={(e) => {
              const next = new Set(checked);
              if (e.currentTarget.checked) next.add(item.id);
              else next.delete(item.id);
              setChecked(next);
              send(props, component.id, 'checklist', [...next]);
            }}
          />
          {item.label}
        </label>
      ))}
    </fieldset>
  );
}

function Choices({
  component,
  props,
}: {
  component: Extract<RichComponent, { type: 'choices' }>;
  props: Props;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-semibold">{component.label}</legend>
      {component.options.map((option) => (
        <label key={option.id} className="flex items-start gap-2">
          <input
            type={component.mode === 'single' ? 'radio' : 'checkbox'}
            name={component.id}
            checked={selected.includes(option.id)}
            disabled={props.readOnly}
            onChange={() => {
              const next =
                component.mode === 'single'
                  ? [option.id]
                  : selected.includes(option.id)
                    ? selected.filter((id) => id !== option.id)
                    : [...selected, option.id];
              setSelected(next);
              send(props, component.id, 'choice', component.mode === 'single' ? option.id : next);
            }}
          />
          <span>
            <span className="block">{option.label}</span>
            {option.description ? (
              <small className="text-text-2">{option.description}</small>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function RichAnswer({ value, blockId, readOnly, onFollowUp }: Props) {
  if (!value || value.components.length === 0)
    return (
      <div
        className="rounded-control border border-border bg-surface-2 p-4"
        aria-label="Rich answer kosong"
      />
    );
  const props = { value, blockId, readOnly, onFollowUp };
  return (
    <div className="rich-answer flex max-w-[72ch] flex-col gap-3" data-readonly={readOnly}>
      {value.components.map((component) => (
        <div key={component.id} className="animate-aios-rise">
          {' '}
          <Component component={component} props={props} />
        </div>
      ))}
    </div>
  );
}

export function RichAnswerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Memuat jawaban kaya" aria-busy="true">
      <div className="h-6 w-1/3 animate-pulse rounded-control bg-surface-2" />
      <div className="h-24 w-full animate-pulse rounded-control bg-surface-2" />
      <div className="h-4 w-2/3 animate-pulse rounded-control bg-surface-2" />
    </div>
  );
}
