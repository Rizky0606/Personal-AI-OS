package app.aios.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.link.AppLink
import app.aios.android.push.PushRegistrar
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import app.aios.android.data.Connectivity
import app.aios.android.data.auth.AuthRepository
import app.aios.android.data.auth.StoredSession
import app.aios.android.data.settings.SettingsStore
import app.aios.android.data.settings.ThemeMode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

sealed interface SessionUi {
    /** Menunggu pembacaan penyimpanan; tampilan kosong sesingkat mungkin agar tidak berkedip. */
    data object Loading : SessionUi

    data object SignedOut : SessionUi

    data class SignedIn(val session: StoredSession) : SessionUi
}

private const val STOP_TIMEOUT_MS = 5_000L

/** Status tingkat aplikasi: tema, sesi, dan koneksi. */
@HiltViewModel
class AppViewModel @Inject constructor(
    auth: AuthRepository,
    settings: SettingsStore,
    connectivity: Connectivity,
    private val push: PushRegistrar
) : ViewModel() {
    private val link = MutableStateFlow<AppLink?>(null)

    /** Tujuan dari share atau notifikasi yang menunggu dibuka; dikonsumsi layar utama setelah login. */
    val pendingLink: StateFlow<AppLink?> = link.asStateFlow()

    fun onLink(value: AppLink?) {
        if (value != null) link.value = value
    }

    fun consumeLink() {
        link.value = null
    }

    init {
        // Token FCM bisa berganti kapan saja; pastikan perangkat ini terdaftar
        // tiap aplikasi dibuka dalam keadaan login.
        viewModelScope.launch {
            auth.session.map { it?.deviceId }.filterNotNull().distinctUntilChanged().collect { push.sync(it) }
        }
    }

    val themeMode: StateFlow<ThemeMode> = settings.themeMode
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.System)

    val session: StateFlow<SessionUi> = auth.session
        .map { if (it == null) SessionUi.SignedOut else SessionUi.SignedIn(it) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, SessionUi.Loading)

    val online: StateFlow<Boolean> = connectivity.connected
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), true)
}
