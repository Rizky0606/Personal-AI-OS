package app.aios.android.data.chat

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/** Batas berkas lampiran, sama dengan gateway (`MAX_FILE_BYTES`). */
const val MAX_ATTACHMENT_BYTES = 25L * 1024 * 1024

/** Berkas yang dipilih pengguna, sudah dibaca ke memori dan siap diunggah. */
class PickedFile(val name: String, val mime: String, val bytes: ByteArray)

/** Berkas melebihi [MAX_ATTACHMENT_BYTES]; ditolak sebelum diunggah. */
class AttachmentTooLargeException(val name: String) : IOException("berkas melebihi 25 MB")

/** Membaca berkas dari URI `content://` pemilih dokumen. Antarmuka supaya ViewModel bisa diuji tanpa Android. */
fun interface AttachmentSource {
    suspend fun read(uri: String): PickedFile
}

class ContentResolverAttachmentSource(private val resolver: ContentResolver) : AttachmentSource {
    override suspend fun read(uri: String): PickedFile = withContext(Dispatchers.IO) {
        val parsed = Uri.parse(uri)
        var name = parsed.lastPathSegment ?: "lampiran"
        var size = -1L
        resolver.query(parsed, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getString(0)?.let { name = it }
                    if (!cursor.isNull(1)) size = cursor.getLong(1)
                }
            }
        if (size > MAX_ATTACHMENT_BYTES) throw AttachmentTooLargeException(name)
        val bytes = resolver.openInputStream(parsed)?.use { input ->
            // Dibaca bertahap dengan batas: ukuran dari provider bisa kosong atau keliru.
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(BUFFER_BYTES)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                out.write(buffer, 0, read)
                if (out.size() > MAX_ATTACHMENT_BYTES) throw AttachmentTooLargeException(name)
            }
            out.toByteArray()
        } ?: throw IOException("berkas tidak bisa dibuka")
        PickedFile(name, resolver.getType(parsed) ?: "application/octet-stream", bytes)
    }

    private companion object {
        const val BUFFER_BYTES = 64 * 1024
    }
}
