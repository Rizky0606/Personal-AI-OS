import { MAX_FILE_BYTES } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { AppError } from '../../errors.js';
import { requireScope } from '../auth/guard.js';
import type { FilesService } from './service.js';

/** Ruang untuk batas multipart dan nama berkas di atas ukuran berkas itu sendiri. */
const BODY_LIMIT = MAX_FILE_BYTES + 1024 * 1024;

/**
 * Unggah lampiran (scope `app`). Multipart diurai dengan `FormData` bawaan Node (undici), jadi tidak
 * butuh plugin multipart; seluruh body (maks ~26 MB) ditampung di memori sekali.
 */
export const fileRoutes: FastifyPluginCallback<{ files: FilesService }> = (
  app,
  { files },
  done,
) => {
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: BODY_LIMIT },
    (_req, body, next) => next(null, body),
  );

  app.post(
    '/files',
    { onRequest: requireScope('app'), bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.startsWith('multipart/form-data') || !Buffer.isBuffer(req.body)) {
        throw new AppError(
          400,
          'invalid_upload',
          'Kirim berkas sebagai multipart/form-data, field "file".',
        );
      }
      let form: FormData;
      try {
        form = await new Request('http://gateway.local/files', {
          method: 'POST',
          headers: { 'content-type': contentType },
          body: req.body,
        }).formData();
      } catch {
        throw new AppError(400, 'invalid_upload', 'Isi multipart tidak valid.');
      }
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new AppError(400, 'invalid_upload', 'Field "file" berisi berkas wajib ada.');
      }
      const record = await files.save({
        name: file.name,
        mime: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
      return reply.code(201).send(record);
    },
  );

  done();
};
