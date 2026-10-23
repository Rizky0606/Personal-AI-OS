package app.aios.android.ui.login

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.api.ServerUrlResult
import app.aios.android.data.auth.AuthRepository
import app.aios.android.data.auth.LoginOutcome
import app.aios.android.data.auth.SessionEvents
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TOTP_LENGTH = 6

data class LoginUiState(
    val serverUrl: String = "",
    val password: String = "",
    val totp: String = "",
    val showPassword: Boolean = false,
    val submitting: Boolean = false,
    @StringRes val serverError: Int? = null,
    @StringRes val passwordError: Int? = null,
    @StringRes val totpError: Int? = null,
    @StringRes val formError: Int? = null
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val auth: AuthRepository,
    events: SessionEvents
) : ViewModel() {
    private val state = MutableStateFlow(LoginUiState())
    val ui: StateFlow<LoginUiState> = state.asStateFlow()

    /** True bila pengguna kembali ke layar ini karena refresh token ditolak, bukan karena logout. */
    val sessionExpired: StateFlow<Boolean> = events.expired

    init {
        viewModelScope.launch {
            val last = auth.lastServerUrl.first()
            if (last != null) state.update { if (it.serverUrl.isEmpty()) it.copy(serverUrl = last) else it }
        }
    }

    fun onServerUrl(value: String) = state.update { it.copy(serverUrl = value, serverError = null, formError = null) }

    fun onPassword(value: String) = state.update { it.copy(password = value, passwordError = null, formError = null) }

    fun onTotp(value: String) = state.update {
        // Hanya digit, maksimal 6, agar tempel dari aplikasi autentikator yang berspasi tetap sah.
        it.copy(totp = value.filter(Char::isDigit).take(TOTP_LENGTH), totpError = null, formError = null)
    }

    fun togglePassword() = state.update { it.copy(showPassword = !it.showPassword) }

    fun submit() {
        val current = state.value
        if (current.submitting) return
        val passwordError = if (current.password.isEmpty()) R.string.login_error_password_empty else null
        val totpError = if (current.totp.length != TOTP_LENGTH) R.string.login_error_totp_format else null
        if (passwordError != null || totpError != null) {
            state.update { it.copy(passwordError = passwordError, totpError = totpError) }
            return
        }
        state.update { it.copy(submitting = true, formError = null, serverError = null) }
        viewModelScope.launch {
            val outcome = auth.login(current.serverUrl, current.password, current.totp)
            state.update { s ->
                when (outcome) {
                    // Sesi tersimpan; AppViewModel yang memindahkan layar. Kosongkan rahasia dari memori UI.
                    LoginOutcome.Success -> s.copy(submitting = false, password = "", totp = "")
                    is LoginOutcome.BadServer -> s.copy(submitting = false, serverError = outcome.reason.messageRes())
                    is LoginOutcome.Failure -> s.copy(submitting = false, formError = outcome.error.messageRes)
                }
            }
        }
    }
}

@StringRes
private fun ServerUrlResult.messageRes(): Int = when (this) {
    ServerUrlResult.Empty -> R.string.login_error_server_empty
    ServerUrlResult.CleartextNotAllowed -> R.string.login_error_server_cleartext
    else -> R.string.login_error_server_invalid
}
