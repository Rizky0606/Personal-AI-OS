import {
  CreateMemoryRequestSchema,
  IdParamsSchema,
  MemoryListSchema,
  UpdateMemoryRequestSchema,
} from '../api-schemas.js';
import { MemorySchema } from '../entities.js';
import { json, noContent, type Endpoint } from '../endpoint.js';

/** Memori yang terlihat (W17): fakta tentang pemilik yang disuntik ke pesan sistem setiap run. */
export const memoryEndpoints: readonly Endpoint[] = [
  {
    operationId: 'listMemories',
    method: 'get',
    path: '/memories',
    tag: 'Memori',
    summary: 'Daftar memori, terlama dulu',
    auth: true,
    responses: [json(200, 'Daftar memori', MemoryListSchema)],
    errors: [401],
  },
  {
    operationId: 'createMemory',
    method: 'post',
    path: '/memories',
    tag: 'Memori',
    summary: 'Tambah memori',
    auth: true,
    body: CreateMemoryRequestSchema,
    responses: [json(201, 'Memori baru', MemorySchema)],
    errors: [400, 401, 409],
  },
  {
    operationId: 'updateMemory',
    method: 'patch',
    path: '/memories/{id}',
    tag: 'Memori',
    summary: 'Ubah teks atau aktifkan/nonaktifkan memori',
    auth: true,
    params: IdParamsSchema,
    body: UpdateMemoryRequestSchema,
    responses: [json(200, 'Memori terbaru', MemorySchema)],
    errors: [400, 401, 404],
  },
  {
    operationId: 'deleteMemory',
    method: 'delete',
    path: '/memories/{id}',
    tag: 'Memori',
    summary: 'Hapus memori',
    auth: true,
    params: IdParamsSchema,
    responses: [noContent('Memori dihapus')],
    errors: [401, 404],
  },
];
