package app.aios.android.ui.proposals

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.AGENT_PROPOSAL_SCHEDULE
import app.aios.android.data.api.AgentProposal
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.CODE_PROPOSAL_DECIDED
import app.aios.android.data.api.toApiError
import app.aios.android.data.proposals.AgentProposalRepository
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException
import javax.inject.Inject

/** Topik notifikasi channel `user` saat agent membuat usulan kartu atau jadwal baru. */
internal const val TOPIC_AGENT_PROPOSAL = "agent_proposal"

private const val HTTP_CONFLICT = 409

sealed interface AgentProposalEvent {
    data class Notice(@StringRes val message: Int) : AgentProposalEvent
}

data class AgentProposalUi(
    val items: List<AgentProposal> = emptyList(),
    val loading: Boolean = true,
    val error: ApiError? = null,
    /** Usulan yang sedang disetujui atau ditolak; tombol lain dinonaktifkan sampai selesai. */
    val deciding: String? = null
)

/**
 * Layar Usulan agent: kartu dan jadwal yang diusulkan agent, disetujui apa adanya atau ditolak (tanpa sunting di
 * Android). Gagal = snackbar; usulan yang sudah diputuskan di perangkat lain (409) membuat daftar dimuat ulang.
 */
@HiltViewModel
class AgentProposalViewModel @Inject constructor(
    private val repo: AgentProposalRepository,
    realtime: RealtimeClient,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(AgentProposalUi())
    val ui: StateFlow<AgentProposalUi> = state.asStateFlow()

    private val notices = Channel<AgentProposalEvent>(Channel.BUFFERED)
    val events: Flow<AgentProposalEvent> = notices.receiveAsFlow()

    init {
        refresh()
        // Usulan baru dari agent dikabarkan lewat notifikasi di channel user: segarkan tanpa kerangka muat.
        viewModelScope.launch {
            realtime.channel("user").collect {
                val event = it.event
                if (event is ServerEvent.Notification && event.topic == TOPIC_AGENT_PROPOSAL) refresh(silent = true)
            }
        }
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) state.update { it.copy(loading = it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            try {
                val items = repo.pending()
                state.update { it.copy(items = items, loading = false, error = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    if (it.items.isEmpty() && !silent) {
                        it.copy(loading = false, error = error)
                    } else {
                        it.copy(loading = false)
                    }
                }
            }
        }
    }

    /** Kartu masuk Backlog; jadwal disimpan dan langsung aktif. */
    fun approve(proposal: AgentProposal) {
        val done = if (proposal.kind == AGENT_PROPOSAL_SCHEDULE) {
            R.string.agent_proposal_approved_schedule
        } else {
            R.string.agent_proposal_approved_task
        }
        decide(proposal, done) { repo.approve(proposal) }
    }

    fun reject(proposal: AgentProposal) = decide(proposal, R.string.agent_proposal_rejected) {
        repo.reject(proposal.id)
    }

    private fun decide(proposal: AgentProposal, @StringRes done: Int, work: suspend () -> Unit) {
        if (state.value.deciding != null) return
        state.update { it.copy(deciding = proposal.id) }
        viewModelScope.launch {
            try {
                work()
                state.update { s -> s.copy(items = s.items.filterNot { it.id == proposal.id }, deciding = null) }
                notices.trySend(AgentProposalEvent.Notice(done))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                val decided = error.code == CODE_PROPOSAL_DECIDED || (e as? HttpException)?.code() == HTTP_CONFLICT
                notices.trySend(
                    AgentProposalEvent.Notice(if (decided) R.string.agent_proposal_decided else error.messageRes)
                )
                state.update { it.copy(deciding = null) }
                // Mis. sudah diputuskan dari perangkat lain: ambil daftar terbaru.
                if (decided) refresh(silent = true)
            }
        }
    }
}
