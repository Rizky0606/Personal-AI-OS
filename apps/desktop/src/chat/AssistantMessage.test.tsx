import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import type * as External from '../lib/external';
import { TooltipProvider } from '../ui/Tooltip';

const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('../lib/external', async (original) => ({
  ...(await original<typeof External>()),
  saveBlob,
}));

const { AssistantMessage } = await import('./AssistantMessage');

const text = [
  'Berikut berkasnya.',
  '```json package.json',
  '{ "name": "todo" }',
  '```',
  '```jsx src/App.jsx',
  'export default function App() {}',
  '```',
].join('\n');

const renderMessage = (streaming: boolean, body = text) =>
  render(
    <TooltipProvider>
      <AssistantMessage
        parts={[{ type: 'text', text: body }]}
        role="general"
        model={null}
        roles={[]}
        streaming={streaming}
      />
    </TooltipProvider>,
  );

beforeEach(() => saveBlob.mockReset());

describe('AssistantMessage: Unduh ZIP', () => {
  it('jawaban selesai dengan blok kode: tombol mengunduh semua berkas sebagai satu zip', async () => {
    const user = userEvent.setup();
    renderMessage(false);

    await user.click(screen.getByRole('button', { name: copy.chat.zip.download(2) }));

    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toMatch(/^kode-\d{12}\.zip$/);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('selama jawaban masih ditulis, atau tanpa blok kode, tombol tidak tampil', () => {
    const view = renderMessage(true);
    expect(screen.queryByRole('button', { name: /ZIP/ })).not.toBeInTheDocument();
    view.unmount();

    renderMessage(false, 'Jawaban tanpa kode.');
    expect(screen.queryByRole('button', { name: /ZIP/ })).not.toBeInTheDocument();
  });
});
