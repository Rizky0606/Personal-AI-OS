package app.aios.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.auth.AuthRepository
import app.aios.android.data.auth.StoredSession
import app.aios.android.data.settings.SettingsStore
import app.aios.android.data.settings.ThemeMode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val STOP_TIMEOUT_MS = 5_000L

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val settings: SettingsStore
) : ViewModel() {
    val theme: StateFlow<ThemeMode> = settings.themeMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), ThemeMode.System)

    val session: StateFlow<StoredSession?> = auth.session
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    private val loggingOutState = MutableStateFlow(false)
    val loggingOut: StateFlow<Boolean> = loggingOutState.asStateFlow()

    fun setTheme(mode: ThemeMode) {
        viewModelScope.launch { settings.setThemeMode(mode) }
    }

    /** Setelah selesai, sesi kosong dan root berpindah ke layar login dengan sendirinya. */
    fun logout() {
        if (loggingOutState.value) return
        loggingOutState.value = true
        viewModelScope.launch {
            try {
                auth.logout()
            } finally {
                loggingOutState.value = false
            }
        }
    }
}
