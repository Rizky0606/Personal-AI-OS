package app.aios.android.ui.memory

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.MEMORY_PROPOSAL_AUTO_SAVED
import app.aios.android.data.api.MEMORY_TEXT_MAX
import app.aios.android.data.api.Memory
import app.aios.android.data.api.MemoryProposal
import app.aios.android.data.api.toApiError
import app.aios.android.data.memory.MemoryRepository
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
import javax.inject.Inject

sealed interface MemoryEvent {
    data class Notice(@StringRes val message: Int) : MemoryEvent

    /** Memori dari "Ingat ini" tersimpan; dialog ditutup. */
    data object Saved : MemoryEvent
}

data class MemoryUi(
    val items: List<Memory> = emptyList(),
    val loading: Boolean = true,
    val error: ApiError? = null,
    val draft: String = "",
    val adding: Boolean = false,
    /** Memori yang sedang diubah di dialog, beserta teks sementaranya. */
    val editing: Memory? = null,
    val editText: String = "",
    val saving: Boolean = false,
    /** Memori yang menunggu konfirmasi hapus. */
    val deleting: Memory? = null,
    /** Usulan memori dari chat umum (menunggu), plus yang disimpan otomatis/diurungkan 7 hari terakhir. */
    val proposals: List<MemoryProposal> = emptyList(),
    /** Usulan yang sedang disetujui, ditolak, atau diurungkan; tombol lain dinonaktifkan sampai selesai. */
    val deciding: String? = null,
    /** Usulan yang sedang disunting di dialog "Ubah lalu simpan", beserta teks sementaranya. */
    val proposalEditing: MemoryProposal? = null,
    val proposalText: String = ""
)

/** Topik notifikasi channel `user` untuk usulan memori baru atau memori yang disimpan otomatis. */
const val MEMORY_PROPOSAL_TOPIC = "memory_proposal"

/**
 * Layar Memori (A9): daftar, tambah, ubah, aktif/nonaktif, hapus, serta setujui (apa adanya atau disunting dulu),
 * tolak, dan urungkan usulan memori dari chat. Notifikasi `memory_proposal` di channel `user` menyegarkan layar.
 * Gagal = snackbar; isian tidak dibuang.
 */
@HiltViewModel
class MemoryViewModel @Inject constructor(
    private val repo: MemoryRepository,
    private val realtime: RealtimeClient,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(MemoryUi())
    val ui: StateFlow<MemoryUi> = state.asStateFlow()

    private val notices = Channel<MemoryEvent>(Channel.BUFFERED)
    val events: Flow<MemoryEvent> = notices.receiveAsFlow()

    init {
        refresh()
        viewModelScope.launch {
            realtime.channel("user").collect {
                val event = it.event
                if (event is ServerEvent.Notification && event.topic == MEMORY_PROPOSAL_TOPIC) refresh()
            }
        }
    }

    fun refresh() {
        state.update { it.copy(loading = it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            try {
                val items = repo.list()
                state.update { it.copy(items = items, loading = false, error = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    if (it.items.isEmpty()) {
                        it.copy(
                            loading = false,
                            error = error
                        )
                    } else {
                        it.copy(loading = false)
                    }
                }
                return@launch
            }
            loadProposals()
        }
    }

    /** Usulan dimuat terpisah: gagal memuatnya jadi snackbar, daftar memori tetap tampil. */
    private suspend fun loadProposals() {
        val proposals = attempt { repo.proposals() } ?: return
        state.update { it.copy(proposals = proposals) }
    }

    /** Setujui apa adanya (tanpa sunting); memori baru atau teks target berubah, jadi daftar dimuat ulang. */
    fun approveProposal(proposal: MemoryProposal) = decide(proposal, R.string.memory_proposal_approved) {
        repo.approveProposal(proposal.id)
        val items = repo.list()
        state.update { it.copy(items = items) }
    }

    fun startEditProposal(proposal: MemoryProposal) =
        state.update { it.copy(proposalEditing = proposal, proposalText = proposal.text.take(MEMORY_TEXT_MAX)) }

    fun onProposalText(value: String) = state.update { it.copy(proposalText = value.take(MEMORY_TEXT_MAX)) }

    fun cancelEditProposal() = state.update { it.copy(proposalEditing = null, proposalText = "") }

    /** "Ubah lalu simpan": teks suntingan (dirapikan, tidak kosong, maks MEMORY_TEXT_MAX) yang disimpan. */
    fun approveEditedProposal() {
        val proposal = state.value.proposalEditing ?: return
        val text = state.value.proposalText.trim()
        if (text.isEmpty()) return
        decide(proposal, R.string.memory_proposal_approved, onDone = { cancelEditProposal() }) {
            repo.approveProposal(proposal.id, text)
            val items = repo.list()
            state.update { it.copy(items = items) }
        }
    }

    fun rejectProposal(proposal: MemoryProposal) = decide(proposal, R.string.memory_proposal_rejected) {
        repo.rejectProposal(proposal.id)
    }

    /** Urungkan memori yang disimpan otomatis: memori hilang dari daftar, usulan tetap tampil sebagai diurungkan. */
    fun undoProposal(proposal: MemoryProposal) {
        if (state.value.deciding != null || proposal.status != MEMORY_PROPOSAL_AUTO_SAVED) return
        state.update { it.copy(deciding = proposal.id) }
        viewModelScope.launch {
            val undone = attempt {
                val result = repo.undoProposal(proposal.id)
                result to repo.list()
            }
            if (undone != null) {
                val (result, items) = undone
                state.update { s ->
                    s.copy(items = items, proposals = s.proposals.map { if (it.id == result.id) result else it })
                }
                notices.trySend(MemoryEvent.Notice(R.string.memory_proposal_undone))
            } else {
                loadProposals()
            }
            state.update { it.copy(deciding = null) }
        }
    }

    private fun decide(
        proposal: MemoryProposal,
        @StringRes done: Int,
        onDone: () -> Unit = {},
        work: suspend () -> Unit
    ) {
        if (state.value.deciding != null) return
        state.update { it.copy(deciding = proposal.id) }
        viewModelScope.launch {
            if (attempt { work() } != null) {
                state.update { s -> s.copy(proposals = s.proposals.filterNot { it.id == proposal.id }) }
                onDone()
                notices.trySend(MemoryEvent.Notice(done))
            } else {
                // Mis. sudah diputuskan dari perangkat lain (409): ambil daftar terbaru.
                loadProposals()
            }
            state.update { it.copy(deciding = null) }
        }
    }

    fun onDraft(value: String) = state.update { it.copy(draft = value.take(MEMORY_TEXT_MAX)) }

    fun add() {
        val text = state.value.draft.trim()
        if (text.isEmpty() || state.value.adding) return
        state.update { it.copy(adding = true) }
        viewModelScope.launch {
            val created = attempt { repo.create(text) }
            state.update { s ->
                if (created != null) {
                    s.copy(
                        items = s.items + created,
                        draft = "",
                        adding = false
                    )
                } else {
                    s.copy(adding = false)
                }
            }
            if (created != null) notices.trySend(MemoryEvent.Notice(R.string.memory_saved))
        }
    }

    /** Sakelar langsung terlihat; dikembalikan bila server menolak. */
    fun setEnabled(memory: Memory, enabled: Boolean) {
        replace(memory.copy(enabled = enabled))
        viewModelScope.launch {
            val updated = attempt { repo.update(memory.id, enabled = enabled) }
            replace(updated ?: memory)
        }
    }

    /** Sematkan atau lepas: langsung terlihat; dikembalikan bila server menolak. */
    fun setPinned(memory: Memory, pinned: Boolean) {
        replace(memory.copy(pinned = pinned))
        viewModelScope.launch {
            val updated = attempt { repo.update(memory.id, pinned = pinned) }
            replace(updated ?: memory)
            if (updated != null) {
                notices.trySend(MemoryEvent.Notice(if (pinned) R.string.memory_pinned else R.string.memory_unpinned))
            }
        }
    }

    fun startEdit(memory: Memory) = state.update { it.copy(editing = memory, editText = memory.text) }

    fun onEditText(value: String) = state.update { it.copy(editText = value.take(MEMORY_TEXT_MAX)) }

    fun cancelEdit() = state.update { it.copy(editing = null, editText = "") }

    fun saveEdit() {
        val target = state.value.editing ?: return
        val text = state.value.editText.trim()
        if (text.isEmpty() || state.value.saving) return
        state.update { it.copy(saving = true) }
        viewModelScope.launch {
            val updated = attempt { repo.update(target.id, text = text) }
            if (updated != null) {
                replace(updated)
                state.update { it.copy(editing = null, editText = "", saving = false) }
                notices.trySend(MemoryEvent.Notice(R.string.memory_updated))
            } else {
                state.update { it.copy(saving = false) }
            }
        }
    }

    fun askDelete(memory: Memory) = state.update { it.copy(deleting = memory) }

    fun cancelDelete() = state.update { it.copy(deleting = null) }

    fun confirmDelete() {
        val target = state.value.deleting ?: return
        state.update { it.copy(deleting = null) }
        viewModelScope.launch {
            if (attempt { repo.delete(target.id) } != null) {
                state.update { s -> s.copy(items = s.items.filterNot { it.id == target.id }) }
                notices.trySend(MemoryEvent.Notice(R.string.memory_removed))
            }
        }
    }

    private fun replace(memory: Memory) = state.update { s ->
        s.copy(items = s.items.map { if (it.id == memory.id) memory else it })
    }

    /** Menjalankan [work]; galat jadi snackbar dan hasilnya null. */
    private suspend fun <T> attempt(work: suspend () -> T): T? = try {
        work()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        notices.trySend(MemoryEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
        null
    }
}

data class RememberUi(val text: String = "", val saving: Boolean = false)

/** "Ingat ini" dari pesan chat: teks pesan disunting lalu disimpan sebagai memori baru. */
@HiltViewModel
class RememberViewModel @Inject constructor(
    private val repo: MemoryRepository,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(RememberUi())
    val ui: StateFlow<RememberUi> = state.asStateFlow()

    private val outcomes = Channel<MemoryEvent>(Channel.BUFFERED)
    val events: Flow<MemoryEvent> = outcomes.receiveAsFlow()

    fun start(text: String) = state.update { RememberUi(text = text.trim().take(MEMORY_TEXT_MAX)) }

    fun onText(value: String) = state.update { it.copy(text = value.take(MEMORY_TEXT_MAX)) }

    fun save() {
        val text = state.value.text.trim()
        if (text.isEmpty() || state.value.saving) return
        state.update { it.copy(saving = true) }
        viewModelScope.launch {
            try {
                repo.create(text)
                state.update { it.copy(saving = false) }
                outcomes.trySend(MemoryEvent.Notice(R.string.memory_saved))
                outcomes.trySend(MemoryEvent.Saved)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { it.copy(saving = false) }
                outcomes.trySend(MemoryEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }
}
