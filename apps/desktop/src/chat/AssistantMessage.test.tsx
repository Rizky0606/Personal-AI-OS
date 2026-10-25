import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import type * as External from '../lib/external';
import { api, resetApi } from '../test/fakeServices';
import { TooltipProvider } from '../ui/Tooltip';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

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

beforeEach(() => {
  saveBlob.mockReset();
  resetApi();
});

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

  it('berkas buatan AI tampil dengan tombol Unduh yang menyimpan isi dari gateway', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['PK'], { type: 'application/zip' });
    api.downloadFile.mockResolvedValue(blob);
    render(
      <TooltipProvider>
        <AssistantMessage
          parts={[
            { type: 'text', text: 'Sudah saya buat.' },
            { type: 'file', fileId: 'f1', name: 'todo-app.zip', mime: 'application/zip' },
          ]}
          role="general"
          model={null}
          roles={[]}
        />
      </TooltipProvider>,
    );
    const list = screen.getByRole('list', { name: copy.chat.generatedFiles });
    expect(within(list).getByText('todo-app.zip')).toBeInTheDocument();
    await user.click(
      within(list).getByRole('button', { name: `${copy.chat.downloadFile}: todo-app.zip` }),
    );
    expect(api.downloadFile).toHaveBeenCalledWith('f1');
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'todo-app.zip'));
  });

  it('selama jawaban masih ditulis, atau tanpa blok kode, tombol tidak tampil', () => {
    const view = renderMessage(true);
    expect(screen.queryByRole('button', { name: /ZIP/ })).not.toBeInTheDocument();
    view.unmount();

    renderMessage(false, 'Jawaban tanpa kode.');
    expect(screen.queryByRole('button', { name: /ZIP/ })).not.toBeInTheDocument();
  });
});
