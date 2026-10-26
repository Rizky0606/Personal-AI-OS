import type { PromptTemplate } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../chat/Composer';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { TemplatesSection } from './TemplatesSection';
import { useTemplateInsert } from './useTemplateInsert';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const TS = '2026-10-26T00:00:00Z';
const tpl = (
  name: string,
  body: string,
  id = `0192f0c4-7a1b-7c2d-8e3f-${name.padEnd(12, '0').slice(0, 12)}`,
) => ({ id, name, body, createdAt: TS, updatedAt: TS }) satisfies PromptTemplate;

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('TemplatesSection', () => {
  it('kosong, lalu menyimpan templat baru dan mengosongkan formulir', async () => {
    const created = tpl('ringkas', 'Ringkas {{topik}}');
    api.listPromptTemplates.mockResolvedValueOnce([]).mockResolvedValue([created]);
    api.createPromptTemplate.mockResolvedValue(created);
    const user = userEvent.setup();
    await renderScreen(<TemplatesSection />);
    expect(await screen.findByText(copy.templates.empty)).toBeInTheDocument();

    await user.type(screen.getByLabelText(copy.templates.nameLabel), ' Ringkas ');
    await user.type(screen.getByLabelText(copy.templates.bodyLabel), 'Ringkas {{{{topik}}');
    await user.click(screen.getByRole('button', { name: copy.templates.add }));

    expect(api.createPromptTemplate).toHaveBeenCalledWith({
      name: 'Ringkas',
      body: 'Ringkas {{topik}}',
    });
    const list = await screen.findByRole('list', { name: copy.templates.listLabel });
    expect(within(list).getByText('/ringkas')).toBeInTheDocument();
    expect(screen.getByLabelText(copy.templates.nameLabel)).toHaveValue('');
  });

  it('nama kembar: toast galat, isian tetap ada', async () => {
    api.createPromptTemplate.mockRejectedValue(
      new ApiProblem(409, 'template_name_taken', 'Sudah ada templat bernama /ringkas.'),
    );
    const user = userEvent.setup();
    await renderScreen(<TemplatesSection />);
    await user.type(await screen.findByLabelText(copy.templates.nameLabel), 'ringkas');
    await user.type(screen.getByLabelText(copy.templates.bodyLabel), 'isi');
    await user.click(screen.getByRole('button', { name: copy.templates.add }));

    expect(await screen.findByText(copy.templates.nameTaken)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.templates.nameLabel)).toHaveValue('ringkas');
  });

  it('mengubah dan menghapus (dengan konfirmasi)', async () => {
    const a = tpl('ringkas', 'Ringkas');
    api.listPromptTemplates.mockResolvedValue([a]);
    api.updatePromptTemplate.mockResolvedValue({ ...a, body: 'Baru' });
    api.deletePromptTemplate.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderScreen(<TemplatesSection />);

    await user.click(
      await screen.findByRole('button', { name: `${copy.templates.edit} /ringkas` }),
    );
    const body = screen.getAllByLabelText(copy.templates.bodyLabel).at(-1)!;
    await user.clear(body);
    await user.type(body, 'Baru');
    await user.click(screen.getByRole('button', { name: copy.templates.saveEdit }));
    expect(api.updatePromptTemplate).toHaveBeenCalledWith(a.id, { name: 'ringkas', body: 'Baru' });

    await user.click(
      await screen.findByRole('button', { name: `${copy.templates.delete} /ringkas` }),
    );
    await user.click(await screen.findByRole('button', { name: copy.templates.delete }));
    await waitFor(() => expect(api.deletePromptTemplate).toHaveBeenCalledWith(a.id));
  });

  it('error dan offline', async () => {
    api.listPromptTemplates.mockRejectedValueOnce(new ApiProblem(500, 'x', 'x'));
    const user = userEvent.setup();
    const view = await renderScreen(<TemplatesSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.server);
    api.listPromptTemplates.mockResolvedValue([tpl('a', 'b')]);
    await user.click(screen.getByRole('button', { name: copy.states.retry }));
    expect(await screen.findByText('/a')).toBeInTheDocument();
    view.unmount();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listPromptTemplates.mockRejectedValue(new ApiProblem(0, 'network', 'x'));
    await renderScreen(<TemplatesSection />);
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});

const templates = [
  tpl('ringkas', 'Ringkas {{topik}} untuk {{audiens}}'),
  tpl('salam', 'Halo, apa kabar?'),
];

function Harness() {
  const [draft, setDraft] = useState('');
  const insert = useTemplateInsert(setDraft);
  return (
    <>
      <Composer
        draft={draft}
        onDraft={setDraft}
        onSend={vi.fn()}
        onStop={vi.fn()}
        streaming={false}
        sending={false}
        models={[]}
        model={null}
        onModel={vi.fn()}
        canEditLast={false}
        onEditLast={vi.fn()}
        focusNonce={0}
        templates={templates}
        onUseTemplate={insert.use}
      />
      {insert.dialog}
    </>
  );
}

describe('menu / di composer', () => {
  const field = () => screen.getByRole('textbox', { name: copy.chat.composerLabel });

  it('muncul untuk /awalan; panah memilih, Enter memasukkan templat tanpa parameter (tidak mengirim)', async () => {
    const user = userEvent.setup();
    await renderScreen(<Harness />);
    await user.type(field(), '/');
    const menu = await screen.findByRole('listbox', { name: copy.templates.menuLabel });
    expect(within(menu).getAllByRole('option')).toHaveLength(2);
    expect(within(menu).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(within(menu).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');

    expect(field()).toHaveValue('Halo, apa kabar?');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('templat berparameter membuka dialog isian lalu mengisi draf', async () => {
    const user = userEvent.setup();
    await renderScreen(<Harness />);
    await user.type(field(), '/rin');
    await user.click(await screen.findByRole('option', { name: /ringkas/ }));

    const dialog = await screen.findByRole('dialog', { name: '/ringkas' });
    await user.type(within(dialog).getByLabelText('topik'), 'AI');
    await user.type(within(dialog).getByLabelText('audiens'), 'manajer');
    await user.click(within(dialog).getByRole('button', { name: copy.templates.insert }));

    await waitFor(() => expect(field()).toHaveValue('Ringkas AI untuk manajer'));
  });

  it('Esc menutup menu tanpa mengubah draf; teks biasa tidak memunculkan menu', async () => {
    const user = userEvent.setup();
    await renderScreen(<Harness />);
    await user.type(field(), '/sa');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveValue('/sa');

    await user.clear(field());
    await user.type(field(), 'halo / dunia');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
