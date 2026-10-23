package app.aios.android.ui.schedules

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.DEFAULT_TIMEZONE
import app.aios.android.data.api.Problem
import app.aios.android.data.api.Schedule
import app.aios.android.data.api.ScheduleParse
import app.aios.android.data.api.ScheduleRun
import app.aios.android.data.api.toApiError
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.data.schedules.ScheduleRepository
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
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import javax.inject.Inject

sealed interface ScheduleEvent {
    data class Notice(@StringRes val message: Int) : ScheduleEvent

    /** Jadwal baru tersimpan; layar kembali ke daftar. */
    data class Created(val id: String) : ScheduleEvent

    data object Deleted : ScheduleEvent

    /** Run manual dimulai; hasilnya muncul di riwayat dan percakapan jadwal. */
    data object RunStarted : ScheduleEvent
}

private const val HTTP_CONFLICT = 409
private const val MIN_TEXT = 6

/** Detail masalah dari body RFC 9457 bila ada; dipakai untuk menjelaskan kenapa kalimat ditolak. */
internal fun Throwable.problemDetail(): String? = (this as? HttpException)?.let { http ->
    runCatching {
        val body = http.response()?.errorBody()?.string().orEmpty()
        Json { ignoreUnknownKeys = true }.decodeFromString(Problem.serializer(), body).detail
    }.getOrNull()
}

/* ---------- Daftar ---------- */

data class ScheduleListUi(
    val items: List<Schedule> = emptyList(),
    val lastRuns: Map<String, ScheduleRun> = emptyMap(),
    val loading: Boolean = true,
    val error: ApiError? = null,
)

@HiltViewModel
class ScheduleListViewModel @Inject constructor(
    private val repo: ScheduleRepository,
    realtime: RealtimeClient,
    private val connectivity: Connectivity,
) : ViewModel() {
    private val state = MutableStateFlow(ScheduleListUi())
    val ui: StateFlow<ScheduleListUi> = state.asStateFlow()

    private val notices = Channel<ScheduleEvent>(Channel.BUFFERED)
    val events: Flow<ScheduleEvent> = notices.receiveAsFlow()

    init {
        refresh()
        // Hasil run dan waktu berikutnya berubah di server: segarkan saat ada kabar di channel user.
        viewModelScope.launch {
            realtime.channel("user").collect { if (it.event is ServerEvent.ScheduleResult) refresh(silent = true) }
        }
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) state.update { it.copy(loading = it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            try {
                val items = repo.list()
                state.update { it.copy(items = items, loading = false, error = null) }
                val runs = repo.lastRuns(items)
                state.update { it.copy(lastRuns = runs) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    if (it.items.isEmpty() && !silent) it.copy(loading = false, error = error) else it.copy(loading = false)
                }
            }
        }
    }

    /** Toggle langsung terlihat; dikembalikan bila server menolak. */
    fun setEnabled(schedule: Schedule, enabled: Boolean) {
        replace(schedule.copy(enabled = enabled))
        viewModelScope.launch {
            try {
                replace(repo.update(schedule.id, null, null, enabled))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                replace(schedule)
                notices.trySend(ScheduleEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    private fun replace(schedule: Schedule) = state.update { s ->
        s.copy(items = s.items.map { if (it.id == schedule.id) schedule else it })
    }
}

/* ---------- Buat: kalimat -> pratinjau -> konfirmasi ---------- */

data class ScheduleCreateUi(
    val text: String = "",
    val parsing: Boolean = false,
    val draft: ScheduleParse? = null,
    val name: String = "",
    val prompt: String = "",
    val saving: Boolean = false,
    @StringRes val textError: Int? = null,
    /** Penjelasan dari server (mis. kalimat bukan jadwal berulang), sudah berbahasa Indonesia. */
    val serverMessage: String? = null,
    @StringRes val formError: Int? = null,
)

@HiltViewModel
class ScheduleCreateViewModel @Inject constructor(
    private val repo: ScheduleRepository,
    private val connectivity: Connectivity,
) : ViewModel() {
    private val state = MutableStateFlow(ScheduleCreateUi())
    val ui: StateFlow<ScheduleCreateUi> = state.asStateFlow()

    private val outcomes = Channel<ScheduleEvent>(Channel.BUFFERED)
    val events: Flow<ScheduleEvent> = outcomes.receiveAsFlow()

    fun onText(value: String) = state.update {
        it.copy(text = value, textError = null, serverMessage = null, formError = null)
    }

    fun onName(value: String) = state.update { it.copy(name = value, formError = null) }

    fun onPrompt(value: String) = state.update { it.copy(prompt = value, formError = null) }

    /** Kembali ke kalimat untuk mengubah waktu atau isi; pratinjau dibuang. */
    fun editText() = state.update { it.copy(draft = null, formError = null) }

    fun parse() {
        val current = state.value
        if (current.parsing) return
        if (current.text.trim().length < MIN_TEXT) {
            state.update { it.copy(textError = R.string.schedule_error_text_short) }
            return
        }
        if (!connectivity.isConnected()) {
            state.update { it.copy(formError = R.string.error_offline) }
            return
        }
        state.update { it.copy(parsing = true, serverMessage = null, formError = null) }
        viewModelScope.launch {
            try {
                val draft = repo.parse(current.text, DEFAULT_TIMEZONE)
                state.update { it.copy(parsing = false, draft = draft, name = draft.name, prompt = draft.prompt) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    it.copy(parsing = false, serverMessage = e.problemDetail(), formError = error.messageRes)
                }
            }
        }
    }

    fun save() {
        val current = state.value
        val draft = current.draft ?: return
        if (current.saving) return
        if (current.name.isBlank() || current.prompt.isBlank()) {
            state.update { it.copy(formError = R.string.schedule_error_fields) }
            return
        }
        state.update { it.copy(saving = true, formError = null) }
        viewModelScope.launch {
            try {
                val created = repo.create(draft, current.name, current.prompt)
                outcomes.trySend(ScheduleEvent.Created(created.id))
                state.value = ScheduleCreateUi()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update {
                    it.copy(saving = false, formError = e.toApiError(connectivity.isConnected()).messageRes)
                }
            }
        }
    }
}

/* ---------- Detail: riwayat, jalankan sekarang, ubah, hapus ---------- */

data class ScheduleDetailUi(
    val schedule: Schedule? = null,
    val runs: List<ScheduleRun> = emptyList(),
    val nextBefore: String? = null,
    val loading: Boolean = true,
    val error: ApiError? = null,
    val runningNow: Boolean = false,
    val saving: Boolean = false,
    val editName: String = "",
    val editPrompt: String = "",
)

@HiltViewModel
class ScheduleDetailViewModel @Inject constructor(
    savedState: SavedStateHandle,
    private val repo: ScheduleRepository,
    realtime: RealtimeClient,
    private val connectivity: Connectivity,
) : ViewModel() {
    private val id: String = checkNotNull(savedState.get<String>("id"))

    private val state = MutableStateFlow(ScheduleDetailUi())
    val ui: StateFlow<ScheduleDetailUi> = state.asStateFlow()

    private val notices = Channel<ScheduleEvent>(Channel.BUFFERED)
    val events: Flow<ScheduleEvent> = notices.receiveAsFlow()

    init {
        load()
        viewModelScope.launch {
            realtime.channel("user").collect {
                val e = it.event
                if (e is ServerEvent.ScheduleResult && e.scheduleId == id) load(silent = true)
            }
        }
    }

    fun load(silent: Boolean = false) {
        if (!silent) state.update { it.copy(loading = it.schedule == null, error = null) }
        viewModelScope.launch {
            try {
                // Tidak ada endpoint ambil-satu; jadwal dicari dari daftar.
                val schedule = repo.list().firstOrNull { it.id == id }
                if (schedule == null) {
                    notices.trySend(ScheduleEvent.Deleted)
                    return@launch
                }
                val runs = repo.runs(id)
                state.update {
                    val first = it.schedule == null
                    it.copy(
                        schedule = schedule,
                        runs = runs.items,
                        nextBefore = runs.nextBefore,
                        loading = false,
                        error = null,
                        editName = if (first) schedule.name else it.editName,
                        editPrompt = if (first) schedule.prompt else it.editPrompt,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    if (it.schedule == null) it.copy(loading = false, error = error) else it.copy(loading = false)
                }
            }
        }
    }

    fun loadMoreRuns() {
        val before = state.value.nextBefore ?: return
        viewModelScope.launch {
            runCatching { repo.runs(id, before) }.onSuccess { page ->
                state.update { it.copy(runs = it.runs + page.items, nextBefore = page.nextBefore) }
            }
        }
    }

    fun onName(value: String) = state.update { it.copy(editName = value) }

    fun onPrompt(value: String) = state.update { it.copy(editPrompt = value) }

    fun setEnabled(enabled: Boolean) {
        val schedule = state.value.schedule ?: return
        state.update { it.copy(schedule = schedule.copy(enabled = enabled)) }
        viewModelScope.launch {
            try {
                state.update { it.copy(schedule = repo.update(id, null, null, enabled)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { it.copy(schedule = schedule) }
                notices.trySend(ScheduleEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    fun saveEdits() {
        val current = state.value
        val schedule = current.schedule ?: return
        if (current.saving || current.editName.isBlank() || current.editPrompt.isBlank()) return
        if (current.editName.trim() == schedule.name && current.editPrompt.trim() == schedule.prompt) return
        state.update { it.copy(saving = true) }
        viewModelScope.launch {
            try {
                val updated = repo.update(id, current.editName, current.editPrompt, null)
                state.update { it.copy(schedule = updated, saving = false) }
                notices.trySend(ScheduleEvent.Notice(R.string.schedule_saved))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { it.copy(saving = false) }
                notices.trySend(ScheduleEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }

    /** Server menolak (409) bila run sebelumnya masih berjalan; pesannya dijelaskan lewat snackbar. */
    fun runNow() {
        if (state.value.runningNow) return
        state.update { it.copy(runningNow = true) }
        viewModelScope.launch {
            try {
                repo.runNow(id)
                notices.trySend(ScheduleEvent.RunStarted)
                load(silent = true)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val conflict = (e as? HttpException)?.code() == HTTP_CONFLICT
                val message = if (conflict) {
                    R.string.schedule_error_running
                } else {
                    e.toApiError(connectivity.isConnected()).messageRes
                }
                notices.trySend(ScheduleEvent.Notice(message))
            } finally {
                state.update { it.copy(runningNow = false) }
            }
        }
    }

    fun delete() {
        viewModelScope.launch {
            try {
                repo.delete(id)
                notices.trySend(ScheduleEvent.Deleted)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.trySend(ScheduleEvent.Notice(e.toApiError(connectivity.isConnected()).messageRes))
            }
        }
    }
}
