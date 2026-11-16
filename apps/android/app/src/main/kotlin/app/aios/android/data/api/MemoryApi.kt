package app.aios.android.data.api

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/* Memori yang terlihat (A9), mengikuti packages/contracts (MemorySchema, endpoints/memory.ts). Ubah bersama kontrak. */

/** Sama dengan MEMORY_TEXT_MAX di kontrak. */
const val MEMORY_TEXT_MAX = 500

@Serializable
data class Memory(
    val id: String,
    val text: String,
    val enabled: Boolean,
    val createdAt: String,
    val updatedAt: String,
    /** Tersemat: selalu ikut ke pesan sistem. Bawaan false untuk server lama tanpa field ini. */
    val pinned: Boolean = false
)

@Serializable
data class MemoryList(val items: List<Memory>)

@Serializable
data class CreateMemoryRequest(val text: String)

@Serializable
data class UpdateMemoryRequest(
    val text: String? = null,
    val enabled: Boolean? = null,
    val pinned: Boolean? = null
)

/**
 * Usulan memori dari ekstraksi fakta di chat umum (MemoryProposalSchema). Hanya field yang dipakai layar; field lain
 * diabaikan (ignoreUnknownKeys).
 */
@Serializable
data class MemoryProposal(
    val id: String,
    /** `add` atau `update`. */
    val kind: String,
    val text: String,
    /** Kutipan pesan pemilik yang menjadi dasar fakta. */
    val evidence: String,
    /** Teks memori yang akan diganti (kind = update). */
    val targetText: String? = null,
    /** `pending`, `auto_saved` (mode auto, bisa diurungkan), `undone`, `approved`, atau `rejected`. */
    val status: String = MEMORY_PROPOSAL_PENDING,
    /** Teks memori target sebelum diganti otomatis (kind = update, status auto_saved/undone). */
    val previousText: String? = null
)

const val MEMORY_PROPOSAL_PENDING = "pending"
const val MEMORY_PROPOSAL_AUTO_SAVED = "auto_saved"
const val MEMORY_PROPOSAL_UNDONE = "undone"

/** Blok usulan: semua yang menunggu ditambah auto_saved/undone 7 hari terakhir (MEMORY_PROPOSAL_RECENT_DAYS). */
const val MEMORY_PROPOSALS_REVIEW = "review"

@Serializable
data class MemoryProposalList(val items: List<MemoryProposal>)

/** Badan setuju; `text` diisi bila usulan disunting dulu ("Ubah lalu simpan"). */
@Serializable
data class ApproveMemoryProposalRequest(val text: String? = null)

interface MemoryApi {
    @GET("memories")
    suspend fun list(): MemoryList

    @POST("memories")
    suspend fun create(@Body body: CreateMemoryRequest): Memory

    @PATCH("memories/{id}")
    suspend fun update(@Path("id") id: String, @Body body: UpdateMemoryRequest): Memory

    @DELETE("memories/{id}")
    suspend fun delete(@Path("id") id: String): Response<Unit>

    /** [status] `review` untuk blok usulan; tanpa query server hanya mengembalikan yang menunggu. */
    @GET("memories/proposals")
    suspend fun proposals(@Query("status") status: String): MemoryProposalList

    @POST("memories/proposals/{id}/approve")
    suspend fun approveProposal(@Path("id") id: String, @Body body: ApproveMemoryProposalRequest): MemoryProposal

    @POST("memories/proposals/{id}/reject")
    suspend fun rejectProposal(@Path("id") id: String): MemoryProposal

    @POST("memories/proposals/{id}/undo")
    suspend fun undoProposal(@Path("id") id: String): MemoryProposal
}
