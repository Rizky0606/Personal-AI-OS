package app.aios.android.data.proposals

import app.aios.android.data.api.AGENT_PROPOSAL_SCHEDULE
import app.aios.android.data.api.AgentProposal
import app.aios.android.data.api.AgentProposalApi
import app.aios.android.data.api.ApproveAgentProposalRequest
import app.aios.android.data.api.ApproveScheduleOverride
import app.aios.android.data.api.ApproveTaskOverride

/**
 * Ubahan pemilik sebelum menyetujui; kolom null berarti isi usulan dipakai apa adanya. Kolom kartu ([title], [body])
 * dan kolom jadwal dipisah karena satu usulan hanya salah satu jenis.
 */
data class AgentProposalEdits(
    val title: String? = null,
    val body: String? = null,
    val name: String? = null,
    val cron: String? = null,
    val timezone: String? = null,
    val prompt: String? = null,
    val enabled: Boolean? = null
)

/** Usulan kartu dan jadwal dari agent, selalu dibaca dari server (tanpa cache). */
interface AgentProposalRepository {
    /** Usulan yang menunggu keputusan, terbaru dulu. */
    suspend fun pending(): List<AgentProposal>

    /**
     * Setujui: kartu masuk Backlog, jadwal langsung aktif. Tanpa [edits] usulan disetujui apa adanya; dengan [edits]
     * hanya kolom yang diisi pemilik yang menimpa isi usulan.
     */
    suspend fun approve(proposal: AgentProposal, edits: AgentProposalEdits? = null): AgentProposal

    suspend fun reject(id: String): AgentProposal
}

class RemoteAgentProposalRepository(private val api: AgentProposalApi) : AgentProposalRepository {
    override suspend fun pending() = api.list().items

    override suspend fun approve(proposal: AgentProposal, edits: AgentProposalEdits?) = api.approve(
        proposal.id,
        when {
            proposal.kind == AGENT_PROPOSAL_SCHEDULE -> ApproveAgentProposalRequest(
                schedule = ApproveScheduleOverride(
                    name = edits?.name,
                    cron = edits?.cron,
                    timezone = edits?.timezone,
                    prompt = edits?.prompt,
                    enabled = edits?.enabled ?: true
                )
            )

            edits != null -> ApproveAgentProposalRequest(
                task = ApproveTaskOverride(title = edits.title, body = edits.body)
            )

            else -> ApproveAgentProposalRequest()
        }
    )

    override suspend fun reject(id: String) = api.reject(id)
}
