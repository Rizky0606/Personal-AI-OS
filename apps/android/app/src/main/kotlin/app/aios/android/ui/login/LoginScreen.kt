package app.aios.android.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.OfflineBanner
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Satu layar: alamat server, password, TOTP. Tanpa langkah tambahan. */
@Composable
fun LoginScreen(online: Boolean, viewModel: LoginViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val expired by viewModel.sessionExpired.collectAsStateWithLifecycle()
    LoginContent(
        ui = ui,
        online = online,
        sessionExpired = expired,
        onServerUrl = viewModel::onServerUrl,
        onPassword = viewModel::onPassword,
        onTotp = viewModel::onTotp,
        onTogglePassword = viewModel::togglePassword,
        onSubmit = viewModel::submit
    )
}

@Composable
fun LoginContent(
    ui: LoginUiState,
    online: Boolean,
    sessionExpired: Boolean,
    onServerUrl: (String) -> Unit,
    onPassword: (String) -> Unit,
    onTotp: (String) -> Unit,
    onTogglePassword: () -> Unit,
    onSubmit: () -> Unit
) {
    val colors = AiosTheme.colors
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .systemBarsPadding()
            .imePadding()
    ) {
        if (!online) OfflineBanner()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Tokens.Space.s24, vertical = Tokens.Space.s32),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
        ) {
            Text(
                text = stringResource(R.string.login_title),
                style = AiosTheme.type.page,
                color = colors.text
            )

            val bannerRes = ui.formError ?: R.string.login_session_expired.takeIf { sessionExpired }
            if (bannerRes != null) ErrorBanner(message = stringResource(bannerRes))

            AiosTextField(
                value = ui.serverUrl,
                onValueChange = onServerUrl,
                label = stringResource(R.string.login_server_label),
                placeholder = stringResource(R.string.login_server_hint),
                errorText = ui.serverError?.let { stringResource(it) },
                enabled = !ui.submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next)
            )
            AiosTextField(
                value = ui.password,
                onValueChange = onPassword,
                label = stringResource(R.string.login_password_label),
                errorText = ui.passwordError?.let { stringResource(it) },
                enabled = !ui.submitting,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                visualTransformation = if (ui.showPassword) {
                    VisualTransformation.None
                } else {
                    PasswordVisualTransformation()
                },
                trailing = {
                    AiosButton(
                        text = stringResource(
                            if (ui.showPassword) R.string.login_hide_password else R.string.login_show_password
                        ),
                        onClick = onTogglePassword,
                        kind = ButtonKind.Ghost
                    )
                }
            )
            AiosTextField(
                value = ui.totp,
                onValueChange = onTotp,
                label = stringResource(R.string.login_totp_label),
                supportingText = stringResource(R.string.login_totp_hint),
                errorText = ui.totpError?.let { stringResource(it) },
                enabled = !ui.submitting,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(onDone = { onSubmit() })
            )

            AiosButton(
                text = stringResource(if (ui.submitting) R.string.login_submitting else R.string.login_submit),
                onClick = onSubmit,
                kind = ButtonKind.Primary,
                enabled = !ui.submitting,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
