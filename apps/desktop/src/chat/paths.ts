import type { useNavigate } from '@tanstack/react-router';

/**
 * Membuka percakapan di tab yang benar: percakapan project di tab Project (chat sesuai folder project),
 * percakapan umum di tab Chat.
 */
export function goConversation(
  navigate: ReturnType<typeof useNavigate>,
  conversation: { id: string; projectId: string | null },
  replace = false,
) {
  return conversation.projectId
    ? navigate({
        to: '/workspace/$projectId/$conversationId',
        params: { projectId: conversation.projectId, conversationId: conversation.id },
        replace,
      })
    : navigate({
        to: '/chat/$conversationId',
        params: { conversationId: conversation.id },
        replace,
      });
}

/** Layar awal tab: chat umum baru, atau chat baru di project. */
export function goHome(navigate: ReturnType<typeof useNavigate>, projectId: string | null) {
  return projectId
    ? navigate({ to: '/workspace/$projectId', params: { projectId } })
    : navigate({ to: '/' });
}
