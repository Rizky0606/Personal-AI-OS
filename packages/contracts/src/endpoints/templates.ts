import {
  CreatePromptTemplateRequestSchema,
  IdParamsSchema,
  PromptTemplateListSchema,
  UpdatePromptTemplateRequestSchema,
} from '../api-schemas.js';
import { PromptTemplateSchema } from '../entities.js';
import { json, noContent, type Endpoint } from '../endpoint.js';

export const templateEndpoints: readonly Endpoint[] = [
  {
    operationId: 'listPromptTemplates',
    method: 'get',
    path: '/prompt-templates',
    tag: 'Templat',
    summary: 'Daftar templat prompt, urut nama',
    auth: true,
    responses: [json(200, 'Daftar templat', PromptTemplateListSchema)],
    errors: [401],
  },
  {
    operationId: 'createPromptTemplate',
    method: 'post',
    path: '/prompt-templates',
    tag: 'Templat',
    summary: 'Simpan templat prompt',
    auth: true,
    body: CreatePromptTemplateRequestSchema,
    responses: [json(201, 'Templat baru', PromptTemplateSchema)],
    errors: [400, 401, 409],
  },
  {
    operationId: 'updatePromptTemplate',
    method: 'patch',
    path: '/prompt-templates/{id}',
    tag: 'Templat',
    summary: 'Ubah nama atau isi templat',
    auth: true,
    params: IdParamsSchema,
    body: UpdatePromptTemplateRequestSchema,
    responses: [json(200, 'Templat terbaru', PromptTemplateSchema)],
    errors: [400, 401, 404, 409],
  },
  {
    operationId: 'deletePromptTemplate',
    method: 'delete',
    path: '/prompt-templates/{id}',
    tag: 'Templat',
    summary: 'Hapus templat',
    auth: true,
    params: IdParamsSchema,
    responses: [noContent('Templat dihapus')],
    errors: [401, 404],
  },
];
