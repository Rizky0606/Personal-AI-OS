package app.aios.android.ui.research

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.ResearchJob
import app.aios.android.data.api.ResearchSource
import app.aios.android.data.api.toApiError
import app.aios.android.data.chat.ChatRepository
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.data.research.ExportFormat
import app.aios.android.data.research.ExportedFile
import app.aios.android.data.research.ResearchRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LiveSource(val id: String, val title: String, val url: String)

/** Kemajuan live dari event `research.progress` dan `research.source`. */
data class LiveProgress(
    val stage: String? = null,
    val progress: Float = 0f,
    val message: String? = null,
    val sources: List<LiveSource> = emptyList()
)

data class ResearchDetailUi(
    val job: ResearchJob? = null,
    val sources: List<ResearchSource> = emptyList(),
    val live: LiveProgress = LiveProgress(),
    val loading: Boolean = true,
    val error: ApiError? = null,
    /** Pesan kegagalan run dari server, bila job berakhir gagal. */
    val failure: String? = null,
    val cancelling: Boolean = false,
    val exporting: ExportFormat? = null,
    val continuing: Boolean = false
) {
    val report: ParsedReport? get() = job?.reportMd?.takeIf { it.isNotBlank() }?.let(ReportParser::parse)
}

sealed interface ResearchEvent {
    data class Notice(@StringRes val message: Int) : ResearchEvent

    data class ExportReady(val file: ExportedFile) : ResearchEvent

    data class OpenChat(val conversationId: String) : ResearchEvent
}

private const val POLL_MS = 5_000L
private const val FINISH_RETRIES = 3
private const val FINISH_RETRY_MS = 1_000L
private const val TITLE_LIMIT = 60

/**
 * Satu job riset. Job berjalan di server, jadi layar ini hanya mengamati: membuka ulang (atau aplikasi
 * baru dibuka) berlangganan `run:<id>` dari seq 0 dan seluruh tahap serta sumber sampai saat ini diputar ulang.
 * Polling tiap 5 detik menjadi jaring pengaman dan sumber rencana sub-pertanyaan (disimpan di job).
 */
@HiltViewModel
class ResearchDetailViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val repo: ResearchRepository,
    private val chat: ChatRepository,
    private val realtime: RealtimeClient,
    private val connectivity: Connectivity
) : ViewModel() {
    private val id: String = checkNotNull(savedState.get<String>("id")) { "id riset wajib ada di argumen navigasi" }

    private val state = MutableStateFlow(ResearchDetailUi())
    val ui: StateFlow<ResearchDetailUi> = state.asStateFlow()

    private val notices = Channel<ResearchEvent>(Channel.BUFFERED)
    val events: Flow<ResearchEvent> = notices.receiveAsFlow()

    private var watchJob: Job? = null

    init {
        load()
    }

    fun retry() {
        state.update { it.copy(loading = it.job == null, error = null) }
        load()
    }

    private fun load() {
        viewModelScope.launch {
            try {
                val detail = repo.get(id)
                state.update { it.copy(job = detail.job, sources = detail.sources, loading = false, error = null) }
                if (detail.job.running) watch(detail.job.runId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    if (it.job == null) {
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

    private fun watch(runId: String?) {
        if (watchJob?.isActive == true) return
        watchJob = viewModelScope.launch {
            val streamed: Flow<ServerEvent> =
                if (runId == null) emptyFlow() else realtime.channel("run:$runId").map { it.event }
            merge(streamed, poll())
                .transformWhile { event ->
                    emit(event)
                    !(event is ServerEvent.RunStatus && event.status in TERMINAL)
                }
                .collect(::apply)
            finish()
        }
    }

    private fun poll(): Flow<ServerEvent> = flow {
        while (true) {
            delay(POLL_MS)
            val detail = runCatching { repo.get(id) }.getOrNull() ?: continue
            state.update { it.copy(job = detail.job, sources = detail.sources) }
            emit(ServerEvent.RunStatus(detail.job.status))
        }
    }

    private fun apply(event: ServerEvent) {
        when (event) {
            is ServerEvent.ResearchProgress -> {
                val stageChanged = state.value.live.stage != event.stage
                state.update {
                    it.copy(
                        live = it.live.copy(
                            stage = event.stage,
                            progress = event.progress.toFloat(),
                            message = event.message
                        )
                    )
                }
                // Rencana sub-pertanyaan tersimpan di job begitu tahap perencanaan selesai.
                if (stageChanged) refreshJob()
            }
            is ServerEvent.ResearchSourceFound -> state.update {
                if (it.live.sources.any { s -> s.id == event.sourceId }) {
                    it
                } else {
                    it.copy(
                        live = it.live.copy(
                            sources = it.live.sources + LiveSource(event.sourceId, event.title, event.url)
                        )
                    )
                }
            }
            is ServerEvent.Failure -> state.update { it.copy(failure = event.message.ifBlank { event.code }) }
            else -> Unit
        }
    }

    private fun refreshJob() {
        viewModelScope.launch {
            runCatching { repo.get(id) }.onSuccess { d ->
                state.update { it.copy(job = d.job, sources = d.sources) }
            }
        }
    }

    private suspend fun finish() {
        for (attempt in 1..FINISH_RETRIES) {
            try {
                val detail = repo.get(id)
                state.update { it.copy(job = detail.job, sources = detail.sources, cancelling = false) }
                break
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (attempt < FINISH_RETRIES) delay(FINISH_RETRY_MS)
            }
        }
    }

    fun cancel() {
        if (state.value.cancelling || state.value.job?.running != true) return
        state.update { it.copy(cancelling = true) }
        viewModelScope.launch {
            try {
                val job = repo.cancel(id)
                state.update { it.copy(job = job, cancelling = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { it.copy(cancelling = false) }
                notices.trySend(ResearchEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    fun export(format: ExportFormat) {
        val job = state.value.job ?: return
        if (state.value.exporting != null || job.status != "completed") return
        state.update { it.copy(exporting = format) }
        viewModelScope.launch {
            try {
                notices.trySend(ResearchEvent.ExportReady(repo.export(job, format)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(ResearchEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            } finally {
                state.update { it.copy(exporting = null) }
            }
        }
    }

    /**
     * Membuat percakapan baru yang memuat laporan sebagai pesan pertama. API chat tidak punya cara
     * menyisipkan konteks tanpa menjalankan run, jadi pesan ini ikut menghasilkan satu jawaban ringkasan.
     */
    fun continueInChat() {
        val job = state.value.job ?: return
        val report = job.reportMd?.takeIf { it.isNotBlank() } ?: return
        if (state.value.continuing) return
        if (!connectivity.isConnected()) {
            notices.trySend(ResearchEvent.Notice(R.string.chat_error_offline_send))
            return
        }
        state.update { it.copy(continuing = true) }
        viewModelScope.launch {
            try {
                val conversation = chat.createConversation(title = "Lanjutan: ${job.question.take(TITLE_LIMIT)}")
                chat.send(conversation.id, continuationPrompt(job.question, report), model = null)
                notices.trySend(ResearchEvent.OpenChat(conversation.id))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(ResearchEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            } finally {
                state.update { it.copy(continuing = false) }
            }
        }
    }

    private companion object {
        val TERMINAL = setOf("completed", "failed", "cancelled")
    }
}

/** Pesan pembuka percakapan lanjutan: laporan lengkap plus instruksi singkat. */
fun continuationPrompt(question: String, reportMd: String): String =
    "Saya ingin melanjutkan pembahasan dari laporan riset berikut.\n\n" +
        "Pertanyaan riset: $question\n\n" +
        "Laporan:\n\n$reportMd\n\n" +
        "Tugas: ringkas temuan utamanya dalam paling banyak 5 butir (tetap pertahankan rujukan [n]), " +
        "lalu tanyakan bagian mana yang ingin saya dalami."
