package app.aios.android.ui.spaces

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.Space
import app.aios.android.data.api.SpaceDocument
import app.aios.android.data.api.toApiError
import app.aios.android.data.chat.AttachmentSource
import app.aios.android.data.chat.ChatRepository
import app.aios.android.data.spaces.SpaceRepository
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

sealed interface SpaceEvent {
    data class Notice(@StringRes val message: Int, val arg: String? = null) : SpaceEvent

    data class Created(val id: String) : SpaceEvent

    data object Deleted : SpaceEvent
}

/* ---------- Daftar dan buat ---------- */

data class SpaceListUi(
    val items: List<Space> = emptyList(),
    val loading: Boolean = true,
    val error: ApiError? = null,
    val name: String = "",
    val creating: Boolean = false
)

@HiltViewModel
class SpaceListViewModel @Inject constructor(
    private val repo: SpaceRepository,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(SpaceListUi())
    val ui: StateFlow<SpaceListUi> = state.asStateFlow()

    private val notices = Channel<SpaceEvent>(Channel.BUFFERED)
    val events: Flow<SpaceEvent> = notices.receiveAsFlow()

    init {
        refresh()
    }

    fun refresh() {
        state.update { it.copy(loading = it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            try {
                val items = repo.list()
                state.update { it.copy(items = items, loading = false) }
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
            }
        }
    }

    fun onName(value: String) = state.update { it.copy(name = value.take(NAME_MAX)) }

    fun create() {
        val name = state.value.name.trim()
        if (name.isEmpty() || state.value.creating) return
        state.update { it.copy(creating = true) }
        viewModelScope.launch {
            try {
                val space = repo.create(name)
                state.update { it.copy(items = listOf(space) + it.items, name = "", creating = false) }
                notices.trySend(SpaceEvent.Created(space.id))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { it.copy(creating = false) }
                notices.trySend(SpaceEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    private companion object {
        const val NAME_MAX = 120
    }
}

/* ---------- Detail: dokumen, chat baru, hapus ---------- */

data class SpaceDetailUi(
    val space: Space? = null,
    val documents: List<SpaceDocument> = emptyList(),
    val loading: Boolean = true,
    val error: ApiError? = null,
    /** Nama berkas yang sedang diunggah dan diindeks. */
    val adding: String? = null
)

@HiltViewModel
class SpaceDetailViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val repo: SpaceRepository,
    private val chat: ChatRepository,
    private val attachments: AttachmentSource,
    private val connectivity: Connectivity
) : ViewModel() {
    private val id: String = checkNotNull(savedState["id"])
    private val state = MutableStateFlow(SpaceDetailUi())
    val ui: StateFlow<SpaceDetailUi> = state.asStateFlow()

    private val notices = Channel<SpaceEvent>(Channel.BUFFERED)
    val events: Flow<SpaceEvent> = notices.receiveAsFlow()

    init {
        refresh()
    }

    fun refresh() {
        state.update { it.copy(loading = it.space == null, error = null) }
        viewModelScope.launch {
            try {
                val space = repo.list().firstOrNull { it.id == id }
                val documents = if (space != null) repo.documents(id) else emptyList()
                state.update { it.copy(space = space, documents = documents, loading = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    if (it.space == null) {
                        it.copy(
                            loading = false,
                            error = error
                        )
                    } else {
                        it.copy(loading = false)
                    }
                }
            }
        }
    }

    /** Unggah lalu indeks berkas satu per satu; satu yang gagal tidak menghentikan sisanya. */
    fun addFiles(uris: List<String>) {
        if (uris.isEmpty() || state.value.adding != null) return
        viewModelScope.launch {
            for (uri in uris) {
                try {
                    val picked = attachments.read(uri)
                    state.update { it.copy(adding = picked.name) }
                    val file = chat.upload(picked)
                    val document = repo.addDocument(id, file.fileId)
                    state.update { it.copy(documents = listOf(document) + it.documents) }
                    notices.trySend(SpaceEvent.Notice(R.string.space_doc_added, document.name))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    notices.trySend(SpaceEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
                }
            }
            state.update { s -> s.copy(adding = null, space = s.space?.copy(documentCount = s.documents.size)) }
        }
    }

    fun removeDocument(document: SpaceDocument) {
        viewModelScope.launch {
            try {
                repo.deleteDocument(id, document.id)
                state.update { s -> s.copy(documents = s.documents.filterNot { it.id == document.id }) }
                notices.trySend(SpaceEvent.Notice(R.string.space_doc_removed))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(SpaceEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    fun delete() {
        viewModelScope.launch {
            try {
                repo.delete(id)
                notices.trySend(SpaceEvent.Deleted)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(SpaceEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }
}
