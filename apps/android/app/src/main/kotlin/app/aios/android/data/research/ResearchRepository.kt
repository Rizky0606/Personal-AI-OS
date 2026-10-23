package app.aios.android.data.research

import app.aios.android.data.api.CreateResearchRequest
import app.aios.android.data.api.Page
import app.aios.android.data.api.ResearchApi
import app.aios.android.data.api.ResearchJob
import app.aios.android.data.api.ResearchJobDetail
import retrofit2.HttpException

enum class ExportFormat(val query: String, val extension: String, val mime: String) {
    Markdown("md", "md", "text/markdown"),
    Pdf("pdf", "pdf", "application/pdf")
}

/** Berkas hasil ekspor di memori (laporan paling banyak beberapa ratus KB). */
class ExportedFile(val name: String, val mime: String, val bytes: ByteArray)

interface ResearchRepository {
    suspend fun list(before: String? = null): Page<ResearchJob>

    suspend fun create(question: String, depth: String): ResearchJob

    suspend fun get(id: String): ResearchJobDetail

    suspend fun cancel(id: String): ResearchJob

    suspend fun export(job: ResearchJob, format: ExportFormat): ExportedFile
}

class RemoteResearchRepository(private val api: ResearchApi) : ResearchRepository {
    override suspend fun list(before: String?) = api.list(before = before)

    override suspend fun create(question: String, depth: String) =
        api.create(CreateResearchRequest(question.trim(), depth))

    override suspend fun get(id: String) = api.get(id)

    override suspend fun cancel(id: String) = api.cancel(id)

    override suspend fun export(job: ResearchJob, format: ExportFormat): ExportedFile {
        val response = api.export(job.id, format.query)
        if (!response.isSuccessful) throw HttpException(response)
        val body = response.body() ?: throw HttpException(response)
        val bytes = body.use { it.bytes() }
        val header = response.headers()["Content-Disposition"]
        return ExportedFile(safeFileName(header, job, format), format.mime, bytes)
    }

    internal companion object {
        private val filenameRe = Regex("""filename="?([^";]+)"?""")

        /** Nama dari header server, dibersihkan agar aman dipakai sebagai nama berkas lokal. */
        fun safeFileName(contentDisposition: String?, job: ResearchJob, format: ExportFormat): String {
            val raw = contentDisposition?.let { filenameRe.find(it)?.groupValues?.get(1) }
            val cleaned = raw?.replace(Regex("""[^A-Za-z0-9._-]"""), "_")?.trim('.', '_')?.take(MAX_NAME)
            return if (cleaned.isNullOrBlank() || !cleaned.endsWith(".${format.extension}")) {
                "riset-${job.id.takeLast(ID_TAIL)}.${format.extension}"
            } else {
                cleaned
            }
        }

        private const val MAX_NAME = 80
        private const val ID_TAIL = 8
    }
}
