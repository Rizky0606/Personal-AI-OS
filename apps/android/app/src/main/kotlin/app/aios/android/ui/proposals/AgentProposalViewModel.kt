package app.aios.android.ui.proposals

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.AGENT_PROPOSAL_SCHEDULE
import app.aios.android.data.api.AgentProposal
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.CODE_INVALID_CRON
import app.aios.android.data.api.CODE_INVALID_TIMEZONE
import app.aios.android.data.api.CODE_PROPOSAL_DECIDED
import app.aios.android.data.api.SCHEDULE_PROPOSAL_NAME_MAX
import app.aios.android.data.api.SCHEDULE_PROPOSAL_PROMPT_MAX
import app.aios.android.data.api.TASK_PROPOSAL_BODY_MAX
import app.aios.android.data.api.TASK_PROPOSAL_TITLE_MAX
import app.aios.android.data.api.toApiError
import app.aios.android.data.proposals.AgentProposalEdits
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

/** Isian dialog "Ubah lalu setujui": [title] dan [body] untuk kartu, sisanya untuk jadwal. */
data class AgentProposalEditDraft(
    val title: String = "",
    val body: String = "",
    val name: String = "",
    val cron: String = "",
    val timezone: String = "",
    val prompt: String = "",
    /** Jadwal langsung aktif setelah disetujui, kecuali pemilik mematikannya. */
    val enabled: Boolean = true
) {
    /** Kolom wajib sudah terisi: judul untuk kartu; nama, cron, zona waktu, dan instruksi untuk jadwal. */
    fun isComplete(kind: String): Boolean = if (kind == AGENT_PROPOSAL_SCHEDULE) {
        name.isNotBlank() && cron.isNotBlank() && timezone.isNotBlank() && prompt.isNotBlank()
    } else {
        title.isNotBlank()
    }

    fun toEdits(kind: String): AgentProposalEdits = if (kind == AGENT_PROPOSAL_SCHEDULE) {
        AgentProposalEdits(
            name = name.trim(),
            cron = cron.trim(),
            timezone = timezone.trim(),
            prompt = prompt.trim(),
            enabled = enabled
        )
    } else {
        AgentProposalEdits(title = title.trim(), body = body.trim())
    }
}

data class AgentProposalUi(
    val items: List<AgentProposal> = emptyList(),
    val loading: Boolean = true,
    val error: ApiError? = null,
    /** Usulan yang sedang disetujui atau ditolak; tombol lain dinonaktifkan sampai selesai. */
    val deciding: String? = null,
    /** Usulan yang sedang disunting di dialog "Ubah lalu setujui", beserta isiannya. */
    val editing: AgentProposal? = null,
    val edit: AgentProposalEditDraft = AgentProposalEditDraft(),
    val saving: Boolean = false
)

/**
 * Layar Usulan agent: kartu dan jadwal yang diusulkan agent, disetujui apa adanya, disunting dulu lalu disetujui,
 * atau ditolak. Gagal = snackbar; usulan yang sudah diputuskan di perangkat lain (409) membuat daftar dimuat ulang.
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
    fun approve(proposal: AgentProposal) = decide(proposal, doneMessage(proposal, enabled = true)) {
        repo.approve(proposal)
    }

    fun reject(proposal: AgentProposal) = decide(proposal, R.string.agent_proposal_rejected) {
        repo.reject(proposal.id)
    }

    /** Buka dialog "Ubah lalu setujui" dengan isian usulan sebagai awalan. */
    fun startEdit(proposal: AgentProposal) = state.update {
        it.copy(
            editing = proposal,
            edit = AgentProposalEditDraft(
                title = proposal.task?.title.orEmpty(),
                body = proposal.task?.body.orEmpty(),
                name = proposal.schedule?.name.orEmpty(),
                cron = proposal.schedule?.cron.orEmpty(),
                timezone = proposal.schedule?.timezone.orEmpty(),
                prompt = proposal.schedule?.prompt.orEmpty()
            )
        )
    }

    fun onTitleChange(value: String) = editDraft { it.copy(title = value.take(TASK_PROPOSAL_TITLE_MAX)) }

    fun onBodyChange(value: String) = editDraft { it.copy(body = value.take(TASK_PROPOSAL_BODY_MAX)) }

    fun onNameChange(value: String) = editDraft { it.copy(name = value.take(SCHEDULE_PROPOSAL_NAME_MAX)) }

    /** Cron dan zona waktu tidak punya batas panjang di kontrak; isinya divalidasi server. */
    fun onCronChange(value: String) = editDraft { it.copy(cron = value) }

    fun onTimezoneChange(value: String) = editDraft { it.copy(timezone = value) }

    fun onPromptChange(value: String) = editDraft { it.copy(prompt = value.take(SCHEDULE_PROPOSAL_PROMPT_MAX)) }

    fun onEnabledChange(value: Boolean) = editDraft { it.copy(enabled = value) }

    fun cancelEdit() = state.update { it.copy(editing = null, edit = AgentProposalEditDraft()) }

    /** Setujui versi yang sudah disunting; kolom wajib kosong tidak dikirim. */
    fun approveEdited() {
        val target = state.value.editing ?: return
        val draft = state.value.edit
        if (state.value.saving || !draft.isComplete(target.kind)) return
        val edits = draft.toEdits(target.kind)
        state.update { it.copy(saving = true) }
        decide(
            proposal = target,
            done = doneMessage(target, enabled = draft.enabled),
            onSettled = { close ->
                state.update {
                    if (close) {
                        it.copy(editing = null, edit = AgentProposalEditDraft(), saving = false)
                    } else {
                        it.copy(saving = false)
                    }
                }
            }
        ) { repo.approve(target, edits) }
    }

    private fun editDraft(change: (AgentProposalEditDraft) -> AgentProposalEditDraft) = state.update {
        it.copy(edit = change(it.edit))
    }

    @StringRes
    private fun doneMessage(proposal: AgentProposal, enabled: Boolean): Int = when {
        proposal.kind != AGENT_PROPOSAL_SCHEDULE -> R.string.agent_proposal_approved_task
        enabled -> R.string.agent_proposal_approved_schedule
        else -> R.string.agent_proposal_approved_schedule_disabled
    }

    /**
     * Menjalankan [work] untuk satu usulan. [onSettled] menerima true bila dialog sunting boleh ditutup (berhasil
     * atau usulan sudah tidak ada lagi), false bila isian harus dipertahankan supaya pemilik bisa memperbaikinya.
     */
    private fun decide(
        proposal: AgentProposal,
        @StringRes done: Int,
        onSettled: (close: Boolean) -> Unit = {},
        work: suspend () -> Unit
    ) {
        if (state.value.deciding != null) return
        state.update { it.copy(deciding = proposal.id) }
        viewModelScope.launch {
            try {
                work()
                state.update { s -> s.copy(items = s.items.filterNot { it.id == proposal.id }, deciding = null) }
                onSettled(true)
                notices.trySend(AgentProposalEvent.Notice(done))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                val decided = error.code == CODE_PROPOSAL_DECIDED || (e as? HttpException)?.code() == HTTP_CONFLICT
                notices.trySend(AgentProposalEvent.Notice(messageFor(error, decided)))
                state.update { it.copy(deciding = null) }
                onSettled(decided)
                // Mis. sudah diputuskan dari perangkat lain: ambil daftar terbaru.
                if (decided) refresh(silent = true)
            }
        }
    }

    /** Cron atau zona waktu hasil suntingan yang ditolak server (400) dijelaskan sendiri, bukan galat umum. */
    @StringRes
    private fun messageFor(error: ApiError, decided: Boolean): Int = when {
        decided -> R.string.agent_proposal_decided
        error.code == CODE_INVALID_CRON -> R.string.agent_proposal_invalid_cron
        error.code == CODE_INVALID_TIMEZONE -> R.string.agent_proposal_invalid_timezone
        else -> error.messageRes
    }
}
