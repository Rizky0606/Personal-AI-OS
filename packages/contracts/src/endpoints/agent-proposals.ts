import {
  AgentProposalListSchema,
  AgentProposalQuerySchema,
  AgentProposalSchema,
  ApproveAgentProposalRequestSchema,
  IdParamsSchema,
} from '../api-schemas.js';
import { json, type Endpoint } from '../endpoint.js';

/**
 * Usulan kartu dan jadwal dari agent (tool `task_propose`/`schedule_propose` di server MCP `aios_tools`,
 * docs/DESIGN_MCP_TOOLS.md bagian 17). Tidak ada kartu atau jadwal yang dibuat sebelum pemilik menyetujui.
 */
export const agentProposalEndpoints: readonly Endpoint[] = [
  {
    operationId: 'listAgentProposals',
    method: 'get',
    path: '/agent-proposals',
    tag: 'Usulan agent',
    summary: 'Daftar usulan kartu dan jadwal dari agent, terbaru dulu (bawaan: menunggu)',
    auth: true,
    query: AgentProposalQuerySchema,
    responses: [json(200, 'Daftar usulan agent', AgentProposalListSchema)],
    errors: [400, 401],
  },
  {
    operationId: 'getAgentProposal',
    method: 'get',
    path: '/agent-proposals/{id}',
    tag: 'Usulan agent',
    summary: 'Satu usulan agent',
    auth: true,
    params: IdParamsSchema,
    responses: [json(200, 'Usulan agent', AgentProposalSchema)],
    errors: [401, 404],
  },
  {
    operationId: 'approveAgentProposal',
    method: 'post',
    path: '/agent-proposals/{id}/approve',
    tag: 'Usulan agent',
    summary: 'Setujui usulan (opsional dengan ubahan): membuat kartu Backlog atau jadwal',
    auth: true,
    params: IdParamsSchema,
    body: ApproveAgentProposalRequestSchema,
    responses: [json(200, 'Usulan yang disetujui', AgentProposalSchema)],
    errors: [400, 401, 404, 409],
  },
  {
    operationId: 'rejectAgentProposal',
    method: 'post',
    path: '/agent-proposals/{id}/reject',
    tag: 'Usulan agent',
    summary: 'Tolak usulan agent',
    auth: true,
    params: IdParamsSchema,
    responses: [json(200, 'Usulan ditolak', AgentProposalSchema)],
    errors: [401, 404, 409],
  },
];
