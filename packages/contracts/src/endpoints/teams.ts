import {
  IdParamsSchema,
  TeamDetailSchema,
  TeamListSchema,
  TeamRequestSchema,
} from '../api-schemas.js';
import { json, type Endpoint } from '../endpoint.js';

export const teamEndpoints: readonly Endpoint[] = [
  {
    operationId: 'createTeam',
    method: 'post',
    path: '/teams',
    tag: 'Team',
    summary: 'Mulai tim Lead + Worker opt-in untuk satu tugas project',
    auth: true,
    body: TeamRequestSchema,
    responses: [json(201, 'Tim yang dimulai', TeamDetailSchema)],
    errors: [400, 401, 404, 409, 503],
  },
  {
    operationId: 'listTeams',
    method: 'get',
    path: '/teams',
    tag: 'Team',
    summary: 'Daftar tim project',
    auth: true,
    responses: [json(200, 'Daftar tim', TeamListSchema)],
    errors: [401],
  },
  {
    operationId: 'getTeam',
    method: 'get',
    path: '/teams/{id}',
    tag: 'Team',
    summary: 'Status tim dan anggotanya',
    auth: true,
    params: IdParamsSchema,
    responses: [json(200, 'Detail tim', TeamDetailSchema)],
    errors: [401, 404],
  },
  {
    operationId: 'cancelTeam',
    method: 'post',
    path: '/teams/{id}/cancel',
    tag: 'Team',
    summary: 'Hentikan seluruh tim',
    auth: true,
    params: IdParamsSchema,
    responses: [json(200, 'Tim setelah pembatalan', TeamDetailSchema)],
    errors: [401, 404, 409],
  },
];
