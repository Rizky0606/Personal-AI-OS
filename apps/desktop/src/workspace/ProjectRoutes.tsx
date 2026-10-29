import { Navigate } from '@tanstack/react-router';
import { useLayoutEffect } from 'react';
import { useConversation } from '../api/queries';
import { ChatScreen } from '../chat/ChatScreen';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { SkeletonList } from '../ui/Skeleton';
import { useProjects } from '../worker/hooks';

/** Menyetel konteks project aktif sebelum layar digambar; panel berkas, preview, dan kanban memakainya. */
function useActiveProject(projectId: string | null) {
  const setActive = useUiStore((s) => s.setActiveProject);
  useLayoutEffect(() => {
    if (useUiStore.getState().activeProjectId !== projectId) setActive(projectId);
  }, [projectId, setActive]);
}

function LoadingConversation() {
  return <SkeletonList label={copy.chat.listLoading} />;
}

/** Chat di tab Chat: selalu umum, tidak terikat folder project. */
export function GeneralChatRoute({ conversationId }: { conversationId: string | undefined }) {
  useActiveProject(null);
  const conversation = useConversation(conversationId);
  const projectId = conversation.data?.projectId;
  if (conversationId !== undefined && projectId) {
    return (
      <Navigate
        to="/workspace/$projectId/$conversationId"
        params={{ projectId, conversationId }}
        replace
      />
    );
  }
  if (conversationId !== undefined && conversation.isPending) {
    return <LoadingConversation />;
  }
  return <ChatScreen conversationId={conversationId} />;
}

/** Chat di tab Project: konteksnya folder project yang dipilih. */
export function ProjectChatRoute({
  projectId,
  conversationId,
}: {
  projectId: string;
  conversationId: string | undefined;
}) {
  useActiveProject(projectId);
  const projects = useProjects();
  const conversation = useConversation(conversationId);

  if (projects.data && !projects.data.some((p) => p.id === projectId)) {
    return <Navigate to="/workspace" replace />;
  }
  if (conversationId !== undefined) {
    if (conversation.isPending) {
      return <LoadingConversation />;
    }
    const owner = conversation.data?.projectId ?? null;
    if (conversation.data && owner !== projectId) {
      // Percakapan milik project lain atau chat umum: buka di tempat yang benar.
      return owner ? (
        <Navigate
          to="/workspace/$projectId/$conversationId"
          params={{ projectId: owner, conversationId }}
          replace
        />
      ) : (
        <Navigate to="/chat/$conversationId" params={{ conversationId }} replace />
      );
    }
  }
  return (
    <ChatScreen key={`${projectId}/${conversationId ?? ''}`} conversationId={conversationId} />
  );
}
