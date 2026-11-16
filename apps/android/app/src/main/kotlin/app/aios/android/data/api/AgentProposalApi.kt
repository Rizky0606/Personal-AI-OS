package app.aios.android.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/*
 * Usulan kartu dan jadwal dari agent (tool `task_propose`/`schedule_propose` di server MCP `aios_tools`), mengikuti
 * packages/contracts (AgentProposalSchema, endpoint /agent-proposals). Ubah bersama kontrak. Usulan memori tidak di
 * sini: masuk ke usulan memori biasa. Android hanya menyetujui apa adanya atau menolak; menyunting dari aplikasi
 * Windows. Nilai enum dibaca sebagai teks supaya nilai baru dari server tidak merusak daftar.
 */

const val AGENT_PROPOSAL_TASK = "task"
const val AGENT_PROPOSAL_SCHEDULE = "schedule"
const val AGENT_PROPOSAL_PENDING = "pending"
const val AGENT_HERMES = "hermes"

/** Kode galat server bila usulan sudah disetujui atau ditolak sebelumnya (409). */
const val CODE_PROPOSAL_DECIDED = "proposal_decided"

@Serializable
data class AgentProposalTask(val title: String, val body: String = "")

@Serializable
data class AgentProposalSchedule(
    val name: String,
    val cron: String,
    val timezone: String,
    val prompt: String,
    /** chat | research */
    val target: String
)

/**
 * Satu usulan. Kontrak berupa union menurut [kind]; di sini satu kelas: [task] terisi untuk `task`, [schedule] dan
 * [description] untuk `schedule`. [reason], judul, isi, dan prompt ditulis agent: tampilkan sebagai teks biasa.
 */
@Serializable
data class AgentProposal(
    val id: String,
    /** task | schedule */
    val kind: String,
    /** pending | approved | rejected */
    val status: String,
    /** omp | hermes */
    val agent: String,
    val reason: String,
    /** Agent sudah membaca isi web sebelum mengusulkan: isi usulan bisa berasal dari halaman web. */
    val afterWeb: Boolean = false,
    val projectId: String? = null,
    val conversationId: String? = null,
    val runId: String? = null,
    /** ID kartu atau jadwal yang dibuat saat disetujui. */
    val resultId: String? = null,
    val createdAt: String,
    val decidedAt: String? = null,
    val task: AgentProposalTask? = null,
    val schedule: AgentProposalSchedule? = null,
    /** Jadwal dalam kalimat, mis. "Setiap Senin 07.00 WIB". */
    val description: String? = null
)

@Serializable
data class AgentProposalList(val items: List<AgentProposal>)

/** Bagian jadwal pada persetujuan; Android hanya mengirim [enabled], selebihnya apa adanya dari usulan. */
@Serializable
data class ApproveScheduleOverride(val enabled: Boolean? = null)

/** Body kosong `{}` = setujui apa adanya. */
@Serializable
data class ApproveAgentProposalRequest(val schedule: ApproveScheduleOverride? = null)

interface AgentProposalApi {
    /** Terbaru dulu; [status] bawaan server `pending`, [kind] kosong = semua jenis. */
    @GET("agent-proposals")
    suspend fun list(
        @Query("status") status: String? = AGENT_PROPOSAL_PENDING,
        @Query("kind") kind: String? = null
    ): AgentProposalList

    @POST("agent-proposals/{id}/approve")
    suspend fun approve(@Path("id") id: String, @Body body: ApproveAgentProposalRequest): AgentProposal

    @POST("agent-proposals/{id}/reject")
    suspend fun reject(@Path("id") id: String): AgentProposal
}
