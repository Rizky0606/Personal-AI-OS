import type { Approval, Conversation, Message, Run, RoutingCorrection } from '@aios/contracts';
import type {
  approvals,
  conversations,
  messages,
  routingCorrections,
  runs,
} from '../../db/schema/index.js';

/** `hermes_session_id` tidak diekspos ke klien (entities.ts). */
export function toConversationDto(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    title: row.title,
    surface: row.surface,
    projectId: row.projectId,
    pinned: row.pinned,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessageDto(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    author: row.author,
    parts: row.parts,
    agentRole: row.agentRole,
    model: row.model,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toApprovalDto(row: typeof approvals.$inferSelect): Approval {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    detail: row.detail,
    status: row.status,
    remember: row.remember,
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

export function toRunDto(row: typeof runs.$inferSelect): Run {
  return {
    id: row.id,
    kind: row.kind,
    engine: row.engine,
    agentRole: row.agentRole,
    model: row.model,
    status: row.status,
    conversationId: row.conversationId,
    taskId: row.taskId,
    branch: row.branch,
    usage: row.usage,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toCorrectionDto(row: typeof routingCorrections.$inferSelect): RoutingCorrection {
  return {
    id: row.id,
    decisionId: row.decisionId,
    fromRole: row.fromRole,
    toRole: row.toRole,
    messageExcerpt: row.messageExcerpt,
    createdAt: row.createdAt.toISOString(),
  };
}
