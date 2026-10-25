import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { TooltipProvider } from '../ui/Tooltip';
import { CodeBlock } from './CodeBlock';

const a = copy.chat.artifact;
const renderBlock = (language: string, code: string, closed = true) =>
  render(
    <TooltipProvider>
      <CodeBlock language={language} code={code} closed={closed} />
    </TooltipProvider>,
  );

describe('CodeBlock: pratinjau artifact', () => {
  it('blok HTML: tampil sebagai kode dulu, Pratinjau menjalankannya di iframe sandbox tanpa same-origin', async () => {
    const user = userEvent.setup();
    renderBlock('html', '<h1>Halo</h1>');
    expect(screen.getByText('<h1>Halo</h1>')).toBeInTheDocument();
    expect(screen.queryByTitle(a.frameTitle)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: a.preview }));

    const frame = screen.getByTitle(a.frameTitle);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-modals');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Halo</h1>');
    await user.click(screen.getByRole('button', { name: a.showCode }));
    expect(screen.queryByTitle(a.frameTitle)).not.toBeInTheDocument();
  });

  it('diagram Mermaid langsung dipratinjau', () => {
    renderBlock('mermaid', 'graph TD\n  A --> B');
    expect(screen.getByTitle(a.frameTitle).getAttribute('srcdoc')).toContain('class="mermaid"');
  });

  it('Perbesar membuka dialog berisi pratinjau yang sama', async () => {
    const user = userEvent.setup();
    renderBlock('svg', '<svg viewBox="0 0 1 1"></svg>');
    await user.click(screen.getByRole('button', { name: a.expand }));
    expect(screen.getByRole('dialog', { name: a.dialogTitle('svg') })).toBeInTheDocument();
    expect(screen.getAllByTitle(a.frameTitle)).toHaveLength(1);
  });

  it('tanpa tombol pratinjau untuk bahasa lain atau blok yang belum selesai ditulis', () => {
    const view = renderBlock('js', 'console.log(1)');
    expect(screen.queryByRole('button', { name: a.preview })).not.toBeInTheDocument();
    view.unmount();
    renderBlock('html', '<p>sedang ditulis', false);
    expect(screen.queryByRole('button', { name: a.preview })).not.toBeInTheDocument();
  });
});
