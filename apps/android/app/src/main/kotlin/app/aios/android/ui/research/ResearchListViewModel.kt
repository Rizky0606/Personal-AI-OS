package app.aios.android.ui.research

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.ResearchJob
import app.aios.android.data.api.toApiError
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.data.research.ResearchRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ResearchListUi(
    val items: List<ResearchJob> = emptyList(),
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: ApiError? = null,
    val nextBefore: String? = null,
    val loadingMore: Boolean = false
)

private const val ACTIVE_POLL_MS = 10_000L

/** Daftar job riset. Penyegaran otomatis saat ada job berjalan atau event `research.completed` masuk. */
@HiltViewModel
class ResearchListViewModel @Inject constructor(
    private val repo: ResearchRepository,
    private val realtime: RealtimeClient,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(ResearchListUi())
    val ui: StateFlow<ResearchListUi> = state.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            realtime.channel("user").collect { e ->
                if (e.event is ServerEvent.ResearchCompleted) refresh(silent = true)
            }
        }
        viewModelScope.launch {
            while (true) {
                delay(ACTIVE_POLL_MS)
                if (state.value.items.any { it.running }) refresh(silent = true)
            }
        }
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) state.update { it.copy(refreshing = true, loading = it.items.isEmpty(), error = null) }
        viewModelScope.launch {
            try {
                val page = repo.list()
                state.update {
                    // Halaman tambahan yang sudah dimuat tetap dipertahankan di bawah halaman terbaru.
                    val tail = it.items.filterNot { old -> page.items.any { n -> n.id == old.id } }
                        .filter { old -> old.id < (page.items.lastOrNull()?.id ?: "") }
                    it.copy(
                        items = page.items + tail,
                        nextBefore = if (tail.isEmpty()) page.nextBefore else it.nextBefore,
                        loading = false,
                        refreshing = false,
                        error = null
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val error = e.toApiError(connectivity.isConnected())
                state.update {
                    if (silent) {
                        it.copy(refreshing = false)
                    } else {
                        it.copy(loading = false, refreshing = false, error = if (it.items.isEmpty()) error else null)
                    }
                }
            }
        }
    }

    fun loadMore() {
        val before = state.value.nextBefore ?: return
        if (state.value.loadingMore) return
        state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = repo.list(before)
                state.update {
                    it.copy(
                        items = it.items + page.items,
                        nextBefore = page.nextBefore,
                        loadingMore = false
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update { it.copy(loadingMore = false) }
            }
        }
    }
}
