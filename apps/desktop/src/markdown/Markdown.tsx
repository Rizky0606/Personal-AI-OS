import { Fragment, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { openExternal } from '../lib/external';
import { CodeBlock } from './CodeBlock';
import type { Inline } from './inline';
import { parseMarkdown, type Block, type ListItem } from './parse';

export interface MarkdownProps {
  source: string;
  /** Nomor rujukan `[n]` ke URL sumber; rujukan yang ada di peta dibuat bisa diklik. */
  citations?: ReadonlyMap<number, string>;
  className?: string;
}

const CITATION = /\[(\d{1,3})]/g;

function ExternalLink({
  url,
  children,
  label,
}: {
  url: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <a
      href={url}
      aria-label={label}
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openExternal(url);
      }}
      className="text-info underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  );
}

function withCitations(
  text: string,
  citations: ReadonlyMap<number, string> | undefined,
): ReactNode {
  if (!citations || citations.size === 0) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const n = Number(match[1]);
    const url = citations.get(n);
    if (!url) continue;
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(
      <ExternalLink key={`${index}-${n}`} url={url} label={`Rujukan ${n}: buka sumber`}>
        {match[0]}
      </ExternalLink>,
    );
    last = index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Inlines({
  nodes,
  citations,
}: {
  nodes: Inline[];
  citations: ReadonlyMap<number, string> | undefined;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{withCitations(node.text, citations)}</Fragment>;
          case 'code':
            return (
              <code key={i} className="rounded-badge bg-surface-2 px-1 font-mono text-ui">
                {node.code}
              </code>
            );
          case 'bold':
            return (
              <strong key={i} className="font-semibold">
                <Inlines nodes={node.children} citations={citations} />
              </strong>
            );
          case 'italic':
            return (
              <em key={i}>
                <Inlines nodes={node.children} citations={citations} />
              </em>
            );
          case 'strike':
            return (
              <s key={i}>
                <Inlines nodes={node.children} citations={citations} />
              </s>
            );
          case 'link':
            return (
              <ExternalLink key={i} url={node.url}>
                <Inlines nodes={node.children} citations={undefined} />
              </ExternalLink>
            );
        }
      })}
    </>
  );
}

const headingClass: Record<number, string> = {
  1: 'text-page font-semibold',
  2: 'text-section font-semibold',
  3: 'text-chat font-semibold',
};

function ListView({
  block,
  citations,
}: {
  block: Extract<Block, { type: 'list' }>;
  citations: ReadonlyMap<number, string> | undefined;
}) {
  const Tag = block.ordered ? 'ol' : 'ul';
  return (
    <Tag
      start={block.ordered ? block.start : undefined}
      className={cn('flex flex-col gap-1 pl-6', block.ordered ? 'list-decimal' : 'list-disc')}
    >
      {block.items.map((item: ListItem, i) => (
        <li key={i}>
          <Inlines nodes={item.inlines} citations={citations} />
          {item.children.length > 0 ? (
            <div className="mt-1 flex flex-col gap-1">
              {item.children.map((child, j) => (
                <BlockView key={j} block={child} citations={citations} />
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </Tag>
  );
}

function BlockView({
  block,
  citations,
}: {
  block: Block;
  citations: ReadonlyMap<number, string> | undefined;
}) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
      return (
        <Tag className={cn('mt-2 text-text', headingClass[block.level] ?? 'text-chat font-medium')}>
          <Inlines nodes={block.inlines} citations={citations} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="whitespace-pre-wrap">
          <Inlines nodes={block.inlines} citations={citations} />
        </p>
      );
    case 'code':
      return <CodeBlock language={block.language} code={block.code} closed={block.closed} />;
    case 'quote':
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-border-strong pl-3 text-text-2">
          {block.blocks.map((child, i) => (
            <BlockView key={i} block={child} citations={citations} />
          ))}
        </blockquote>
      );
    case 'list':
      return <ListView block={block} citations={citations} />;
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-ui">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border-b border-border-strong px-2 py-1 text-left font-semibold"
                  >
                    <Inlines nodes={cell} citations={citations} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-b border-border px-2 py-1 align-top">
                      <Inlines nodes={cell} citations={citations} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="border-border" />;
  }
}

/** Menampilkan Markdown sebagai elemen React (tanpa HTML mentah). Lebar baca maksimal 72 karakter. */
export function Markdown({ source, citations, className }: MarkdownProps) {
  const blocks = parseMarkdown(source);
  return (
    <div className={cn('flex max-w-[72ch] flex-col gap-3 text-chat text-text', className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} citations={citations} />
      ))}
    </div>
  );
}
