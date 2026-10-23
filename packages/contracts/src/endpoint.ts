import type { z } from 'zod';

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

export interface EndpointResponse {
  status: number;
  description: string;
  schema?: z.ZodType;
  contentType?: string;
}

export interface Endpoint {
  operationId: string;
  method: HttpMethod;
  /** Gaya OpenAPI: /conversations/{id}. */
  path: string;
  tag: string;
  summary: string;
  /** false hanya untuk login, refresh, dan health. */
  auth: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  bodyContentType?: 'application/json' | 'multipart/form-data';
  responses: EndpointResponse[];
  /** Status error yang dikembalikan sebagai Problem. */
  errors: number[];
}

export const json = (status: number, description: string, schema: z.ZodType): EndpointResponse => ({
  status,
  description,
  schema,
});
export const noContent = (description = 'Berhasil, tanpa isi'): EndpointResponse => ({
  status: 204,
  description,
});
