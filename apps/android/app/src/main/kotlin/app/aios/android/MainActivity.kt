package app.aios.android

import android.graphics.Color
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import app.aios.android.link.IntentLinks
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.ui.login.LoginScreen
import app.aios.android.ui.main.MainScreen
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.isDarkTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val appViewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Setelah rotasi, intent lama tidak boleh diproses lagi.
        if (savedInstanceState == null) appViewModel.onLink(IntentLinks.from(intent))
        setContent { AiosRoot(activity = this) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        appViewModel.onLink(IntentLinks.from(intent))
    }
}

@Composable
private fun AiosRoot(activity: ComponentActivity, viewModel: AppViewModel = hiltViewModel()) {
    val mode by viewModel.themeMode.collectAsStateWithLifecycle()
    val session by viewModel.session.collectAsStateWithLifecycle()
    val online by viewModel.online.collectAsStateWithLifecycle()
    val link by viewModel.pendingLink.collectAsStateWithLifecycle()
    val dark = isDarkTheme(mode)

    // Ikon status dan navigasi mengikuti tema aplikasi, bukan hanya tema sistem.
    DisposableEffect(dark) {
        val style = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark }
        activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
        onDispose {}
    }

    AiosTheme(darkTheme = dark) {
        when (val state = session) {
            SessionUi.Loading -> Box(Modifier.fillMaxSize().background(AiosTheme.colors.bg))
            SessionUi.SignedOut -> LoginScreen(online = online)
            is SessionUi.SignedIn -> MainScreen(
                online = online,
                sessionKey = state.session.deviceId,
                link = link,
                onLinkConsumed = viewModel::consumeLink
            )
        }
    }
}
