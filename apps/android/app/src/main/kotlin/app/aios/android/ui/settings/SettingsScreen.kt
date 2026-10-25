package app.aios.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import android.content.Intent
import android.provider.Settings
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.BuildConfig
import app.aios.android.R
import app.aios.android.data.settings.ThemeMode
import app.aios.android.debug.DebugFeatures
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

@Composable
fun SettingsScreen(
    onOpenCatalog: () -> Unit,
    onOpenMemory: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val session by viewModel.session.collectAsStateWithLifecycle()
    val theme by viewModel.theme.collectAsStateWithLifecycle()
    val loggingOut by viewModel.loggingOut.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Section(R.string.settings_device_section)
        AiosListItem(
            title = stringResource(R.string.settings_device_name),
            trailing = session?.deviceName.orEmpty()
        )
        AiosListItem(
            title = stringResource(R.string.settings_device_id),
            trailing = session?.deviceId?.take(DEVICE_ID_PREVIEW).orEmpty()
        )
        AiosListItem(
            title = stringResource(R.string.settings_server),
            trailing = session?.serverUrl.orEmpty()
        )
        AiosListItem(
            title = stringResource(R.string.settings_app_version),
            trailing = BuildConfig.VERSION_NAME
        )

        Section(R.string.memory_title)
        AiosListItem(
            title = stringResource(R.string.memory_settings_item),
            supporting = stringResource(R.string.memory_settings_supporting),
            onClick = onOpenMemory
        )

        Section(R.string.assistant_section)
        val context = LocalContext.current
        AiosListItem(
            title = stringResource(R.string.assistant_item),
            supporting = stringResource(R.string.assistant_supporting),
            onClick = {
                // Peran asisten tidak bisa diminta lewat dialog; pemilik memilihnya di Aplikasi default.
                runCatching { context.startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) }
            }
        )

        Section(R.string.settings_theme_section)
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8),
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
        ) {
            ThemeChip(
                R.string.settings_theme_system,
                theme == ThemeMode.System
            ) { viewModel.setTheme(ThemeMode.System) }
            ThemeChip(R.string.settings_theme_light, theme == ThemeMode.Light) { viewModel.setTheme(ThemeMode.Light) }
            ThemeChip(R.string.settings_theme_dark, theme == ThemeMode.Dark) { viewModel.setTheme(ThemeMode.Dark) }
        }

        Section(R.string.settings_account_section)
        Column(modifier = Modifier.padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8)) {
            AiosButton(
                text = stringResource(if (loggingOut) R.string.settings_logout_working else R.string.settings_logout),
                onClick = viewModel::logout,
                kind = ButtonKind.Danger,
                enabled = !loggingOut,
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (DebugFeatures.ENABLED) {
            Section(R.string.settings_debug_section)
            AiosListItem(title = stringResource(R.string.settings_debug_catalog), onClick = onOpenCatalog)
        }
    }
}

private const val DEVICE_ID_PREVIEW = 8

@Composable
private fun Section(titleRes: Int) {
    Text(
        text = stringResource(titleRes),
        style = AiosTheme.type.section,
        color = AiosTheme.colors.text,
        modifier = Modifier.padding(start = Tokens.Space.s16, end = Tokens.Space.s16, top = Tokens.Space.s24)
    )
}

@Composable
private fun ThemeChip(labelRes: Int, selected: Boolean, onClick: () -> Unit) {
    AiosChip(text = stringResource(labelRes), selected = selected, onClick = onClick)
}
