package app.aios.android.data.proposals

import app.aios.android.data.api.AGENT_PROPOSAL_SCHEDULE
import app.aios.android.data.api.AgentProposal
import app.aios.android.data.api.AgentProposalApi
import app.aios.android.data.api.ApproveAgentProposalRequest
import app.aios.android.data.api.ApproveScheduleOverride

/** Usulan kartu dan jadwal dari agent, selalu dibaca dari server (tanpa cache). */
interface AgentProposalRepository {
    /** Usulan yang menunggu keputusan, terbaru dulu. */
    suspend fun pending(): List<AgentProposal>

    /** Setujui apa adanya: kartu masuk Backlog, jadwal langsung aktif. */
    suspend fun approve(proposal: AgentProposal): AgentProposal

    suspend fun reject(id: String): AgentProposal
}

class RemoteAgentProposalRepository(private val api: AgentProposalApi) : AgentProposalRepository {
    override suspend fun pending() = api.list().items

    override suspend fun approve(proposal: AgentProposal) = api.approve(
        proposal.id,
        if (proposal.kind == AGENT_PROPOSAL_SCHEDULE) {
            ApproveAgentProposalRequest(schedule = ApproveScheduleOverride(enabled = true))
        } else {
            ApproveAgentProposalRequest()
        }
    )

    override suspend fun reject(id: String) = api.reject(id)
}
