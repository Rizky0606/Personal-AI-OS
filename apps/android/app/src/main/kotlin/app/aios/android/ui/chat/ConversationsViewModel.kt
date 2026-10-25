package app.aios.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.Conversation
import app.aios.android.data.api.SearchHit
import app.aios.android.data.api.toApiError
import app.aios.android.data.chat.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ConversationsUiState(
    val items: List<Conversation> = emptyList(),
    val query: String = "",
    val archived: Boolean = false,
    /** True sampai penyegaran pertama selesai dan belum ada cache. */
    val loading: Boolean = true,
    val error: ApiError? = null,
    /** Hasil pencarian isi riwayat dari server untuk query saat ini (minimal 2 karakter). */
    val history: List<SearchHit> = emptyList()
)

private const val SEARCH_DEBOUNCE_MS = 200L

/** Pencarian server menunggu lebih lama dari filter judul lokal. */
private const val HISTORY_DEBOUNCE_MS = 350L
private const val HISTORY_MIN_CHARS = 2

@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
@HiltViewModel
class ConversationsViewModel @Inject constructor(
    private val repo: ChatRepository,
    private val connectivity: Connectivity
) : ViewModel() {
    private val query = MutableStateFlow("")
    private val archived = MutableStateFlow(false)
    private val refreshState = MutableStateFlow(RefreshState(loading = true, error = null))

    private data class RefreshState(val loading: Boolean, val error: ApiError?)

    private val notices = Channel<ChatEvent>(Channel.BUFFERED)
    val events: Flow<ChatEvent> = notices.receiveAsFlow()

    private val items: Flow<List<Conversation>> = combine(
        query.debounce(SEARCH_DEBOUNCE_MS),
        archived
    ) { q, a -> q to a }
        .flatMapLatest { (q, a) -> repo.conversations(q, a) }

    private val history: Flow<List<SearchHit>> = query.debounce(HISTORY_DEBOUNCE_MS).flatMapLatest { q ->
        flow {
            val text = q.trim()
            // Gagal (mis. offline) berarti tanpa hasil riwayat; daftar judul lokal tetap tampil.
            emit(
                if (text.length < HISTORY_MIN_CHARS) {
                    emptyList()
                } else {
                    runCatching {
                        repo.search(
                            text
                        )
                    }.getOrDefault(emptyList())
                }
            )
        }
    }

    val ui: StateFlow<ConversationsUiState> = combine(
        items,
        query,
        archived,
        refreshState,
        history
    ) { list, q, a, r, h ->
        ConversationsUiState(
            items = list,
            query = q,
            archived = a,
            loading = r.loading && list.isEmpty(),
            error = if (list.isEmpty()) r.error else null,
            history = if (q.trim().length < HISTORY_MIN_CHARS) emptyList() else h
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, ConversationsUiState())

    init {
        refresh()
    }

    fun onQuery(value: String) {
        query.value = value
    }

    fun setArchivedMode(value: Boolean) {
        if (archived.value == value) return
        archived.value = value
        refresh()
    }

    fun refresh() {
        refreshState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                repo.refreshConversations(archived.value)
                refreshState.value = RefreshState(loading = false, error = null)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                refreshState.value = RefreshState(loading = false, error = e.toApiError(connectivity.isConnected()))
            }
        }
    }

    fun togglePinned(conversation: Conversation) = act { repo.setPinned(conversation.id, !conversation.pinned) }

    fun setArchived(conversation: Conversation, value: Boolean) = act { repo.setArchived(conversation.id, value) }

    fun delete(conversation: Conversation) = act { repo.delete(conversation.id) }

    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(ChatEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }
}
