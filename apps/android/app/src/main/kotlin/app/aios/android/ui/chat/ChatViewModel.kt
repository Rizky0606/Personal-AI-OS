package app.aios.android.ui.chat

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.AUTHOR_ASSISTANT
import app.aios.android.data.api.AUTHOR_USER
import app.aios.android.data.api.Message
import app.aios.android.data.api.ModelInfo
import app.aios.android.data.api.RoleInfo
import app.aios.android.data.api.RunError
import app.aios.android.data.api.TERMINAL_RUN_STATUSES
import app.aios.android.data.api.toApiError
import app.aios.android.data.chat.ChatRepository
import app.aios.android.data.realtime.ConnectionState
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Pesan pengguna yang sudah tampil tetapi belum dikonfirmasi server. */
data class PendingMessage(val text: String)

data class ChatUiState(
    val conversationId: String? = null,
    val title: String = "",
    val messages: List<Message> = emptyList(),
    /** True sampai cache atau jaringan memberi jawaban pertama; layar menampilkan skeleton. */
    val loading: Boolean = false,
    val loadError: ApiError? = null,
    val hasMore: Boolean = false,
    val loadingOlder: Boolean = false,
    val pending: PendingMessage? = null,
    val live: LiveRun? = null,
    /** Error run terakhir (gagal di server); hilang saat pesan baru dikirim. */
    val runError: RunError? = null,
    val draft: String = "",
    val sending: Boolean = false,
    val models: List<ModelInfo> = emptyList(),
    /** Null = otomatis (default sesuai role). */
    val selectedModel: String? = null,
    val roles: List<RoleInfo> = emptyList()
) {
    /** Jawaban sedang mengalir: tombol kirim berubah menjadi hentikan. */
    val streaming: Boolean get() = live != null && !live.finished

    val busy: Boolean get() = sending || streaming

    val lastUserMessage: Message? get() = messages.lastOrNull { it.author == AUTHOR_USER }

    val lastAssistantMessage: Message? get() = messages.lastOrNull { it.author == AUTHOR_ASSISTANT }
}

sealed interface ChatEvent {
    data class Notice(@StringRes val message: Int) : ChatEvent
}

private const val RUN_POLL_MS = 15_000L
private const val FINISH_RETRIES = 3
private const val FINISH_RETRY_MS = 1_000L

/**
 * Satu ViewModel untuk tab Chat: percakapan aktif, streaming, composer. Sumber kebenaran pesan adalah
 * Room (disegarkan dari server); jawaban yang sedang mengalir hidup di [ChatUiState.live] sampai server
 * mengonfirmasi hasil akhirnya.
 */
@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repo: ChatRepository,
    private val realtime: RealtimeClient,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(ChatUiState())
    val ui: StateFlow<ChatUiState> = state.asStateFlow()

    private val notices = Channel<ChatEvent>(Channel.BUFFERED)
    val events: Flow<ChatEvent> = notices.receiveAsFlow()

    val connection: StateFlow<ConnectionState> = realtime.state
    val online: StateFlow<Boolean> = connectivity.connected
        .stateIn(viewModelScope, SharingStarted.Eagerly, connectivity.isConnected())

    private var observeJob: Job? = null
    private var runJob: Job? = null
    private val drafts = HashMap<String?, String>()

    init {
        loadCatalog()
        viewModelScope.launch {
            online.collect { isOnline ->
                if (!isOnline) return@collect
                realtime.reconnectNow()
                state.value.conversationId?.let { refresh(it) }
            }
        }
    }

    /** Membuka percakapan [id], atau layar percakapan baru bila null. */
    fun open(id: String?) {
        if (id == state.value.conversationId && (id != null || observeJob == null)) return
        drafts[state.value.conversationId] = state.value.draft
        runJob?.cancel()
        observeJob?.cancel()
        state.update {
            ChatUiState(
                conversationId = id,
                draft = drafts[id].orEmpty(),
                loading = id != null,
                models = it.models,
                roles = it.roles,
                selectedModel = it.selectedModel
            )
        }
        if (id != null) attach(id)
    }

    fun retryLoad() {
        state.value.conversationId?.let {
            state.update { s -> s.copy(loading = s.messages.isEmpty(), loadError = null) }
            viewModelScope.launch { refresh(it) }
        }
    }

    private fun attach(id: String) {
        observeJob?.cancel()
        observeJob = viewModelScope.launch {
            launch {
                repo.messages(id).collect { list ->
                    state.update { it.copy(messages = list, loading = it.loading && list.isEmpty()) }
                }
            }
            launch { repo.conversation(id).collect { c -> state.update { it.copy(title = c?.title.orEmpty()) } } }
            refresh(id)
        }
    }

    private suspend fun refresh(id: String) {
        try {
            val more = repo.refreshMessages(id)
            state.update { it.copy(hasMore = more, loading = false, loadError = null) }
            resumeIfRunning(id)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val error = e.toApiError(connectivity.isConnected())
            // Cache yang ada tetap ditampilkan; error layar penuh hanya bila tidak ada apa-apa. Cache dibaca
            // langsung dari repositori: state baru terisi sesaat setelah Room memancarkannya.
            val hasCache = runCatching { repo.messages(id).first().isNotEmpty() }.getOrDefault(false)
            state.update {
                if (hasCache) it.copy(loading = false) else it.copy(loading = false, loadError = error)
            }
        }
    }

    /** Pesan terakhir milik run yang belum selesai (aplikasi ditutup di tengah jawaban): lanjutkan mengikutinya. */
    private suspend fun resumeIfRunning(id: String) {
        if (state.value.live != null) return
        val runId = repo.messages(id).first().lastOrNull { it.runId != null }?.runId ?: return
        val run = runCatching { repo.run(runId) }.getOrNull() ?: return
        if (run.status !in TERMINAL_RUN_STATUSES && state.value.conversationId == id) observeRun(runId)
    }

    fun onDraft(text: String) = state.update { it.copy(draft = text) }

    fun selectModel(id: String?) = state.update { it.copy(selectedModel = id) }

    fun editLast() {
        val text = state.value.lastUserMessage?.text ?: return
        if (!state.value.busy) state.update { it.copy(draft = text) }
    }

    /** Mengirim ulang teks pesan terakhir sebagai pesan baru (API tidak punya edit di tempat). */
    fun resendLast() {
        val text = state.value.lastUserMessage?.text ?: return
        if (state.value.busy) return
        state.update { it.copy(draft = text) }
        send()
    }

    fun send() {
        val snapshot = state.value
        val text = snapshot.draft.trim()
        if (text.isEmpty() || snapshot.busy) return
        if (!connectivity.isConnected()) {
            notices.trySend(ChatEvent.Notice(R.string.chat_error_offline_send))
            return
        }
        state.update {
            it.copy(sending = true, pending = PendingMessage(text), draft = "", runError = null, loadError = null)
        }
        viewModelScope.launch {
            try {
                val conversationId = snapshot.conversationId ?: repo.createConversation().id.also { newId ->
                    state.update { it.copy(conversationId = newId) }
                    attach(newId)
                }
                val response = repo.send(conversationId, text, snapshot.selectedModel)
                state.update { it.copy(sending = false, pending = null) }
                observeRun(response.run.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update {
                    it.copy(sending = false, pending = null, draft = it.draft.ifEmpty { text })
                }
                notices.trySend(ChatEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    fun stop() {
        val runId = state.value.live?.runId ?: return
        viewModelScope.launch {
            try {
                repo.cancel(runId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(ChatEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    /** Mengganti role jawaban terakhir lalu menjalankan ulang. Server hanya menerima untuk pesan terakhir. */
    fun reroute(role: String) {
        val message = state.value.lastAssistantMessage ?: return
        if (state.value.busy) return
        viewModelScope.launch {
            try {
                val run = repo.reroute(message.id, role)
                state.update { it.copy(runError = null) }
                observeRun(run.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(ChatEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    fun loadOlder() {
        val id = state.value.conversationId ?: return
        if (!state.value.hasMore || state.value.loadingOlder) return
        state.update { it.copy(loadingOlder = true) }
        viewModelScope.launch {
            try {
                val more = repo.loadOlder(id)
                state.update { it.copy(hasMore = more, loadingOlder = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { it.copy(loadingOlder = false) }
                notices.trySend(ChatEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    /**
     * Mengikuti satu run lewat channel `run:<id>` dari seq 0 (replay penuh, jadi tidak ada yang
     * terlewat walau aplikasi baru membuka atau baru tersambung ulang). Polling status tiap 15 detik
     * menjadi jaring pengaman bila event penutup tidak pernah sampai.
     */
    private fun observeRun(runId: String) {
        runJob?.cancel()
        runJob = viewModelScope.launch {
            var current = LiveRun(runId)
            state.update { it.copy(live = current) }
            val streamed = realtime.channel("run:$runId").map { it.event }
            merge(streamed, pollStatus(runId))
                .transformWhile { event ->
                    current = current.reduce(event)
                    emit(current)
                    !current.finished
                }
                .collect { live -> state.update { it.copy(live = live) } }
            finishRun(current)
        }
    }

    private fun pollStatus(runId: String): Flow<ServerEvent> = flow {
        while (true) {
            delay(RUN_POLL_MS)
            val run = runCatching { repo.run(runId) }.getOrNull() ?: continue
            run.error?.let { emit(ServerEvent.Failure(it.code, it.message, it.retryable)) }
            emit(ServerEvent.RunStatus(run.status))
        }
    }

    /** Mengambil hasil akhir dari server (sumber kebenaran), baru melepas tampilan streaming. */
    private suspend fun finishRun(last: LiveRun) {
        val conversationId = state.value.conversationId
        if (conversationId != null) {
            for (attempt in 1..FINISH_RETRIES) {
                try {
                    val more = repo.refreshMessages(conversationId)
                    state.update { it.copy(hasMore = it.hasMore || more) }
                    break
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (attempt < FINISH_RETRIES) delay(FINISH_RETRY_MS)
                }
            }
        }
        val failed = last.status == "failed" || last.error != null
        state.update {
            it.copy(
                live = null,
                runError = if (failed) last.error ?: RunError("run_failed", "", false) else null
            )
        }
    }

    private fun loadCatalog() {
        viewModelScope.launch {
            runCatching { repo.models() }.onSuccess { models -> state.update { it.copy(models = models) } }
            runCatching { repo.roles() }.onSuccess { roles -> state.update { it.copy(roles = roles) } }
        }
    }
}
