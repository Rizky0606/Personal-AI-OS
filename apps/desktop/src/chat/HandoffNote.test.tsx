import { HANDOFF_PREFIX } from '@aios/contracts';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { message } from '../test/fixtures';
import { resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { MessageList } = await import('./MessageList');

beforeEach(() => resetApi());

const list = (messages: ReturnType<typeof message>[]) => (
  <MessageList
    messages={messages}
    live={undefined}
    failure={null}
    pending={null}
    roles={[]}
    approvals={[]}
    resolvingApprovals={new Set()}
    onResolveApproval={() => undefined}
    onResendLast={() => undefined}
    hasMore={false}
    loadingOlder={false}
    onLoadOlder={() => undefined}
    editableUserId={null}
  />
);

describe('pesan sistem di percakapan', () => {
  it('ringkasan percakapan lanjutan tampil sebagai catatan; pesan sistem lain tidak', async () => {
    await renderScreen(
      list([
        message({
          author: 'system',
          text: `${HANDOFF_PREFIX} ("Toko"):\n\n- Tujuan: katalog produk.`,
        }),
        message({ author: 'system', text: 'Jadwal Berita AI berjalan.' }),
        message({ author: 'user', text: 'Lanjutkan' }),
      ]),
    );

    expect(await screen.findByText(copy.chat.handoff.noteTitle)).toBeInTheDocument();
    expect(screen.getByText(/Tujuan: katalog produk/)).toBeInTheDocument();
    expect(screen.queryByText(/Jadwal Berita AI berjalan/)).not.toBeInTheDocument();
    expect(screen.getByText('Lanjutkan')).toBeInTheDocument();
  });
});
