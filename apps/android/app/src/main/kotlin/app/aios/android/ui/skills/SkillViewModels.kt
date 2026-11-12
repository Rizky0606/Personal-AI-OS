package app.aios.android.ui.skills

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.ApiError
import app.aios.android.data.api.SkillSummary
import app.aios.android.data.api.toApiError
import app.aios.android.data.skills.SkillRepository
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

sealed interface SkillEvent {
    data class Notice(@StringRes val message: Int) : SkillEvent
}

data class SkillUi(
    val items: List<SkillSummary> = emptyList(),
    val loading: Boolean = true,
    val error: ApiError? = null
)

/** Kode galat server saat skill inti dinonaktifkan (409). */
internal const val CODE_SKILL_CORE = "skill_core"

/** Layar Skill: daftar dan aktif/nonaktif. Gagal = snackbar dan sakelar kembali; daftar tidak dibuang. */
@HiltViewModel
class SkillViewModel @Inject constructor(
    private val repo: SkillRepository,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(SkillUi())
    val ui: StateFlow<SkillUi> = state.asStateFlow()

    private val notices = Channel<SkillEvent>(Channel.BUFFERED)
    val events: Flow<SkillEvent> = notices.receiveAsFlow()

    init {
        refresh()
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
                    if (it.items.isEmpty()) it.copy(loading = false, error = error) else it.copy(loading = false)
                }
            }
        }
    }

    /** Sakelar langsung terlihat; dikembalikan bila server menolak (mis. skill inti). */
    fun setActive(skill: SkillSummary, active: Boolean) {
        if (skill.isActive == active) return
        replace(skill.copy(status = if (active) "active" else "disabled"))
        viewModelScope.launch {
            try {
                val updated = repo.setActive(skill.id, active)
                replace(updated)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                replace(skill)
                val error = e.toApiError(connectivity.isConnected())
                val message = if (error.code == CODE_SKILL_CORE) R.string.skills_core_locked else error.messageRes
                notices.trySend(SkillEvent.Notice(message))
            }
        }
    }

    private fun replace(skill: SkillSummary) = state.update { s ->
        s.copy(items = s.items.map { if (it.id == skill.id) skill else it })
    }
}
