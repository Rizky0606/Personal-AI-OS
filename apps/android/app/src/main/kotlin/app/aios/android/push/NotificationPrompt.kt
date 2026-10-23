package app.aios.android.push

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.settings.SettingsStore
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val STOP_TIMEOUT_MS = 5_000L

@HiltViewModel
class NotificationPromptViewModel @Inject constructor(
    private val settings: SettingsStore,
    registrar: PushRegistrar
) : ViewModel() {
    /** Push hanya berguna bila Firebase terpasang; tanpa itu penjelasan izin tidak perlu ditampilkan. */
    val pushAvailable: Boolean = registrar.available

    /** Belum tahu = anggap sudah ditampilkan, supaya banner tidak berkedip sebelum DataStore terbaca. */
    val shown: StateFlow<Boolean> = settings.notificationPromptShown
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), true)

    fun dismiss() {
        viewModelScope.launch { settings.markNotificationPromptShown() }
    }
}

/**
 * Satu kalimat penjelasan sebelum meminta izin notifikasi (Android 13+), tanpa dialog yang menghalangi.
 * Muncul sekali; "Nanti" juga menandainya sudah ditampilkan.
 */
@Composable
fun NotificationPrompt(viewModel: NotificationPromptViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val shown by viewModel.shown.collectAsStateWithLifecycle()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        viewModel.dismiss()
    }
    val needsPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED
    if (shown || !viewModel.pushAvailable || !needsPermission) return

    val colors = AiosTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surface2)
            .padding(Tokens.Space.s16),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        Text(
            text = stringResource(R.string.notification_prompt),
            style = AiosTheme.type.ui,
            color = colors.text
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
            AiosButton(
                text = stringResource(R.string.notification_prompt_allow),
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                },
                kind = ButtonKind.Secondary
            )
            AiosButton(
                text = stringResource(R.string.notification_prompt_later),
                onClick = viewModel::dismiss,
                kind = ButtonKind.Ghost
            )
        }
    }
}
