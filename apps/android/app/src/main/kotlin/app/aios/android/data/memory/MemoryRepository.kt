package app.aios.android.data.memory

import app.aios.android.data.api.ApproveMemoryProposalRequest
import app.aios.android.data.api.CreateMemoryRequest
import app.aios.android.data.api.MEMORY_PROPOSALS_REVIEW
import app.aios.android.data.api.Memory
import app.aios.android.data.api.MemoryApi
import app.aios.android.data.api.MemoryProposal
import app.aios.android.data.api.UpdateMemoryRequest
import retrofit2.HttpException

/** Memori selalu dibaca dari server (tanpa cache): yang disuntik ke agent adalah isi server. */
interface MemoryRepository {
    suspend fun list(): List<Memory>

    suspend fun create(text: String): Memory

    suspend fun update(id: String, text: String? = null, enabled: Boolean? = null, pinned: Boolean? = null): Memory

    suspend fun delete(id: String)

    /** Usulan menunggu persetujuan ditambah memori yang disimpan otomatis/diurungkan 7 hari terakhir. */
    suspend fun proposals(): List<MemoryProposal>

    /** [text] = hasil suntingan pemilik ("Ubah lalu simpan"); null = simpan apa adanya. */
    suspend fun approveProposal(id: String, text: String? = null): MemoryProposal

    suspend fun rejectProposal(id: String): MemoryProposal

    /** Mengurungkan memori yang disimpan otomatis (status auto_saved). */
    suspend fun undoProposal(id: String): MemoryProposal
}

class RemoteMemoryRepository(private val api: MemoryApi) : MemoryRepository {
    override suspend fun list() = api.list().items

    override suspend fun create(text: String) = api.create(CreateMemoryRequest(text.trim()))

    override suspend fun update(id: String, text: String?, enabled: Boolean?, pinned: Boolean?) =
        api.update(id, UpdateMemoryRequest(text?.trim(), enabled, pinned))

    override suspend fun delete(id: String) {
        val response = api.delete(id)
        if (!response.isSuccessful) throw HttpException(response)
    }

    override suspend fun proposals() = api.proposals(MEMORY_PROPOSALS_REVIEW).items

    override suspend fun approveProposal(id: String, text: String?) =
        api.approveProposal(id, ApproveMemoryProposalRequest(text?.trim()))

    override suspend fun rejectProposal(id: String) = api.rejectProposal(id)

    override suspend fun undoProposal(id: String) = api.undoProposal(id)
}
