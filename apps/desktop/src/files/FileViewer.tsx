import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Paperclip } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { workerApi } from '../app/services';
import { copy } from '../copy';
import { Markdown } from '../markdown/Markdown';
import { highlightLine, languageOf } from '../review/highlight';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { StateView, type ViewState } from '../ui/StateView';
import { useToastStore } from '../ui/Toaster';
import type { FilesTarget } from './FilesPanel';

/** Berkas yang dikirim ke prompt dipotong supaya satu lampiran tidak memenuhi konteks. */
export const MAX_ATTACH_CHARS = 20_000;

const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** Teks lampiran konteks: berkas sebagai blok kode dengan path di baris pembuka. */
export function attachmentText(path: string, content: string): string {
  const cut = content.length > MAX_ATTACH_CHARS;
  const body = cut ? content.slice(0, MAX_ATTACH_CHARS) : content;
  const language = languageOf(path) ?? '';
  return [
    `\`\`\`${language} ${path}`,
    body,
    '```',
    ...(cut ? [`[dipotong: hanya ${MAX_ATTACH_CHARS} karakter pertama]`] : []),
  ].join('\n');
}

/** Satu berkas: kode dengan nomor baris, Markdown (tampilan atau sumber), atau gambar; bisa dikirim ke prompt. */
export function FileViewer({
  target,
  path,
  onBack,
}: {
  target: FilesTarget;
  path: string;
  onBack: () => void;
}) {
  const online = useOnline();
  const addAttachment = useUiStore((s) => s.addAttachment);
  const push = useToastStore((s) => s.push);
  const [source, setSource] = useState(false);
  const query = useQuery({
    queryKey: ['worker', 'fileRead', target.projectId, target.runId ?? null, path],
    queryFn: () => workerApi.filesRead(target, path),
  });
  const data = query.data;
  const language = languageOf(path);
  const lines = useMemo(
    () =>
      data?.kind === 'text' ? data.content.split('\n').map((l) => highlightLine(l, language)) : [],
    [data, language],
  );

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError
      ? online
        ? 'error'
        : 'offline'
      : data?.kind === 'text' && data.content === ''
        ? 'empty'
        : 'content';

  function attach() {
    if (data?.kind !== 'text') return;
    addAttachment({ id: `file:${path}`, label: path, text: attachmentText(path, data.content) });
    push(copy.files.attached, 'info');
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <IconButton label={copy.files.back} onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-ui text-text" title={path}>
          {path}
        </span>
        {data?.kind === 'text' && isMarkdown(path) ? (
          <Button variant="secondary" aria-pressed={source} onClick={() => setSource((s) => !s)}>
            {source ? copy.files.rendered : copy.files.source}
          </Button>
        ) : null}
        {data?.kind === 'text' ? (
          <Button variant="secondary" onClick={attach}>
            <Paperclip size={14} strokeWidth={1.5} aria-hidden="true" />
            {copy.files.attach}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <StateView
          state={view}
          loadingLabel={copy.files.loading}
          emptyMessage={copy.files.emptyFile}
          errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
          offlineMessage={copy.states.offline}
          retryLabel={copy.states.retry}
          onRetry={() => void query.refetch()}
          emptyAction={
            <Button variant="secondary" onClick={onBack}>
              {copy.files.closeFile}
            </Button>
          }
        >
          {data?.kind === 'image' ? (
            <div className="flex justify-center p-4">
              <img
                alt={path}
                src={`data:${data.mime};base64,${data.content}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : data?.kind === 'binary' ? (
            <p className="p-4 text-ui text-text-2">{copy.files.binary}</p>
          ) : data?.kind === 'too_large' ? (
            <p className="p-4 text-ui text-text-2">{copy.files.tooLarge}</p>
          ) : data && isMarkdown(path) && !source ? (
            <div className="p-4">
              <Markdown source={data.content} />
              {data.truncated ? (
                <p className="pt-2 text-meta text-text-3">{copy.files.cut}</p>
              ) : null}
            </div>
          ) : (
            <>
              <ol aria-label={copy.files.content} className="font-mono text-ui leading-5 text-text">
                {lines.map((html, i) => (
                  <li key={i} className="flex gap-3 px-3">
                    <span
                      aria-hidden="true"
                      className="w-8 shrink-0 text-right text-text-3 select-none"
                    >
                      {i + 1}
                    </span>
                    {/* `html` berasal dari highlightLine: isi baris sudah di-escape. */}
                    <span
                      className="min-w-0 break-all whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  </li>
                ))}
              </ol>
              {data?.truncated ? (
                <p className="p-3 text-meta text-text-3">{copy.files.cut}</p>
              ) : null}
            </>
          )}
        </StateView>
      </div>
    </div>
  );
}
