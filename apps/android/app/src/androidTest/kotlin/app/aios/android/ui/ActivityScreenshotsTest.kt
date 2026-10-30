package app.aios.android.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import app.aios.android.R
import app.aios.android.ui.chat.Composer
import app.aios.android.ui.chat.VoiceInputState
import app.aios.android.ui.chat.activity.ActivityPhase
import app.aios.android.ui.chat.activity.RunActivity
import app.aios.android.ui.chat.activity.sampleTrace
import app.aios.android.ui.components.AgentOrb
import app.aios.android.ui.components.EmptyState
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.FloatingNavBar
import app.aios.android.ui.components.NavBarItem
import app.aios.android.ui.components.SkeletonList
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.MotionSpec
import app.aios.ui.tokens.Tokens
import org.junit.Rule
import org.junit.Test
import java.io.File

/**
 * Mengambil tangkapan layar komponen sesi 7 dan 8 ke `files/shots` aplikasi (di-pull ke docs/screenshots/08-android).
 * Animasi dimatikan (MotionSpec.Reduced) supaya hasilnya stabil. Bukan tes perilaku: tidak ada assertion selain
 * bahwa berkas tertulis.
 */
class ActivityScreenshotsTest {
    @get:Rule
    val compose = createComposeRule()

    private val dir: File = File(
        InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null),
        "shots"
    ).apply { mkdirs() }

    private var darkTheme by mutableStateOf(false)
    private var fontScale by mutableStateOf(1f)
    private var current by mutableStateOf<@Composable () -> Unit>({})

    // setContent hanya boleh sekali per tes: tema, skala font, dan isi diganti lewat state.
    private fun start() {
        compose.setContent {
            AiosTheme(darkTheme = darkTheme, motion = MotionSpec.Reduced) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(AiosTheme.colors.bg)
                            .padding(Tokens.Space.s16),
                        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
                    ) { current() }
                }
            }
        }
    }

    private fun capture(name: String, dark: Boolean, scale: Float = 1f, content: @Composable () -> Unit) {
        compose.runOnUiThread {
            darkTheme = dark
            fontScale = scale
            current = content
        }
        compose.waitForIdle()
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        File(dir, "$name-${if (dark) "gelap" else "terang"}.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, PNG_QUALITY, it)
        }
    }

    @Test
    fun ambilSemuaTangkapanLayar() {
        start()
        for (dark in listOf(false, true)) {
            capture("1-fase-aktivitas", dark) {
                ActivityPhase.entries.filter { it != ActivityPhase.Idle && it != ActivityPhase.Cancelled }
                    .forEach { RunActivity(sampleTrace(it)) }
            }
            capture("2-orb-semua-fase", dark) {
                androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s16)) {
                    AgentPhase.entries.forEach { AgentOrb(it) }
                }
            }
            capture("3-skala-font-200", dark, scale = 2f) {
                RunActivity(sampleTrace(ActivityPhase.Tool))
                RunActivity(sampleTrace(ActivityPhase.Done))
            }
            capture("4-empat-state", dark) {
                SkeletonList(rows = 2)
                EmptyState(message = "Belum ada pesan.", actionLabel = "Mulai chat", onAction = {})
                ErrorBanner(message = "Chat belum bisa dimuat. Periksa koneksi lalu coba lagi.", onRetry = {})
                RunActivity(sampleTrace(ActivityPhase.Done))
            }
            capture("5-composer-kirim-berhenti", dark) {
                val voice = remember { VoiceInputState(false, {}, {}) }
                Composer("Tolong periksa build", {}, false, false, "Otomatis", {}, {}, {}, voice)
                Composer("", {}, true, false, "Otomatis", {}, {}, {}, voice, phase = AgentPhase.Tool)
                Composer("", {}, true, false, "Otomatis", {}, {}, {}, voice, phase = AgentPhase.Writing)
            }
            capture("6-navigasi-bawah", dark) {
                FloatingNavBar(
                    items = listOf(
                        NavBarItem("chat", R.drawable.ic_chat, "Chat"),
                        NavBarItem("research", R.drawable.ic_research, "Riset"),
                        NavBarItem("schedules", R.drawable.ic_schedule, "Jadwal"),
                        NavBarItem("spaces", R.drawable.ic_library, "Ruang")
                    ),
                    selectedKey = "research",
                    onSelect = {}
                )
            }
        }
    }

    private companion object {
        const val PNG_QUALITY = 100
    }
}
