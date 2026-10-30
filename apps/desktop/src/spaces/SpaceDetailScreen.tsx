import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, MessageSquarePlus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useSpaceConversations, useSpaceDocuments, useSpaces } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Page, PageHeader, enterDelay } from '../screens/PageLayout';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { PageContainer } from '../ui/PageContainer';
import { StateView, type ViewState } from '../ui/StateView';
import { useSpaceActions } from './useSpaceActions';

/** Berkas yang bisa diindeks gateway (sama dengan jenis dokumen lampiran chat). */
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.xml,.yaml,.yml,text/*';

/** Satu ruang: dokumennya, percakapannya, dan tombol chat baru yang memakai dokumen sebagai sumber. */
export function SpaceDetailScreen({ spaceId }: { spaceId: string }) {
  const online = useOnline();
  const spacesQuery = useSpaces();
  const docsQuery = useSpaceDocuments(spaceId);
  const chatsQuery = useSpaceConversations(spaceId);
  const actions = useSpaceActions();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const s = copy.spaces;

  const space = spacesQuery.data?.find((x) => x.id === spaceId);
  const docs = docsQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const uploading = actions.busy?.startsWith('add:') ?? false;

  const view: ViewState = spacesQuery.isPending
    ? 'loading'
    : spacesQuery.isError && !spacesQuery.data
      ? online
        ? 'error'
        : 'offline'
      : space
        ? 'content'
        : 'empty';

  return (
    <Page>
      {space ? null : (
        <Link
          to="/spaces"
          className="flex w-fit items-center gap-1 rounded-control text-ui text-text-2 transition-colors duration-[120ms] ease-aios hover:text-text"
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          {s.back}
        </Link>
      )}
      <StateView
        state={view}
        loadingLabel={s.loading}
        emptyMessage={copy.errors.notFound}
        emptyAction={
          <Button variant="secondary" onClick={() => void navigate({ to: '/spaces' })}>
            {s.viewAll}
          </Button>
        }
        errorMessage={spacesQuery.isError ? apiErrorMessage(spacesQuery.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void spacesQuery.refetch()}
      >
        {space ? (
          <PageContainer>
          <div className="flex flex-col gap-6">
            <PageHeader
              back={
                <Link
                  to="/spaces"
                  className="flex w-fit items-center gap-1 rounded-control text-ui text-text-2 transition-colors duration-[120ms] ease-aios hover:text-text"
                >
                  <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                  {s.back}
                </Link>
              }
              title={space.name}
              {...(space.description ? { description: space.description } : {})}
              actions={
                <>
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    {s.delete}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!online || actions.busy === 'chat'}
                    onClick={() => void actions.newChat(space.id)}
                  >
                    <MessageSquarePlus size={14} strokeWidth={1.5} aria-hidden="true" />
                    {s.newChat}
                  </Button>
                </>
              }
            />

            <section
              aria-labelledby="space-docs"
              className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-5"
            >
              <div className="flex items-center justify-between">
                <h3 id="space-docs" className="text-chat font-semibold text-text">
                  {s.documents}
                </h3>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    if (files.length) void actions.addFiles(space.id, files);
                  }}
                />
                <Button
                  variant="secondary"
                  disabled={!online || uploading}
                  onClick={() => picker.current?.click()}
                >
                  <Upload size={14} strokeWidth={1.5} aria-hidden="true" />
                  {uploading ? s.adding : s.addDocument}
                </Button>
              </div>
              {docsQuery.isPending ? (
                <p role="status" className="text-ui text-text-2">
                  {copy.states.loading}
                </p>
              ) : docsQuery.isError && docs.length === 0 ? (
                <p role="alert" className="text-ui text-danger">
                  {apiErrorMessage(docsQuery.error, online)}
                </p>
              ) : docs.length === 0 ? (
                <EmptyState
                  message={s.documentsEmpty}
                  action={
                    <Button
                      variant="secondary"
                      disabled={!online || uploading}
                      onClick={() => picker.current?.click()}
                    >
                      {s.pickDocument}
                    </Button>
                  }
                />
              ) : (
                <ul
                  aria-label={s.documents}
                  className="flex flex-col divide-y divide-border overflow-hidden rounded-control border border-border"
                >
                  {docs.map((doc, index) => (
                    <li
                      key={doc.id}
                      className="flex animate-aios-enter items-center gap-3 px-3 py-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
                      style={enterDelay(index)}
                    >
                      <FileText
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden="true"
                        className="text-text-2"
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-ui text-text">{doc.name}</span>
                        <span className="text-meta text-text-2">
                          {s.docMeta(doc.chars, doc.chunks)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        disabled={!online || actions.busy === `remove:${doc.id}`}
                        onClick={() => void actions.removeDocument(space.id, doc.id)}
                      >
                        {s.removeDocument}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="space-chats" className="flex flex-col gap-2">
              <h3 id="space-chats" className="text-chat font-semibold text-text">
                {s.conversations}
              </h3>
              {chats.length === 0 ? (
                <EmptyState
                  message={s.conversationsEmpty}
                  action={
                    <Button
                      variant="secondary"
                      disabled={!online || actions.busy === 'chat'}
                      onClick={() => void actions.newChat(space.id)}
                    >
                      {s.startChat}
                    </Button>
                  }
                />
              ) : (
                <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface">
                  {chats.map((chat, index) => (
                    <li key={chat.id} className="animate-aios-enter" style={enterDelay(index)}>
                      <Link
                        to="/chat/$conversationId"
                        params={{ conversationId: chat.id }}
                        className="block px-4 py-2 text-ui text-info transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
                      >
                        {chat.title || s.untitled}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          </PageContainer>
        ) : null}
      </StateView>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={s.deleteTitle}
        body={s.deleteBody}
        confirmLabel={s.delete}
        cancelLabel={copy.chat.cancel}
        destructive
        busy={actions.busy === 'delete'}
        onConfirm={() => {
          setConfirmDelete(false);
          void actions.remove(spaceId);
        }}
      />
    </Page>
  );
}
