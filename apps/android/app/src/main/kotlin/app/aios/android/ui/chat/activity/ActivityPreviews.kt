@file:Suppress("UnusedPrivateMember") // fungsi @Preview dipanggil oleh Android Studio, bukan kode

package app.aios.android.ui.chat.activity

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.PreviewFontScale
import androidx.compose.ui.tooling.preview.PreviewLightDark
import app.aios.android.ui.chat.ChatWelcome
import app.aios.android.ui.components.EmptyState
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.SkeletonList
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

private const val T0 = 1_000_000L

private fun tool(id: String, name: String, status: String, target: String?, ms: Long? = null, at: Long? = T0) =
    TraceTool(id, name, target, status, ms, at)

/** Jejak contoh per fase untuk preview; `settled` memakai status final. */
internal fun sampleTrace(phase: ActivityPhase): RunTrace = when (phase) {
    ActivityPhase.Idle -> RunTrace()
    ActivityPhase.Thinking -> RunTrace(
        status = "running",
        reasoning = "Saya akan memeriksa konfigurasi build dulu.",
        lastActivity = LastActivity.Reasoning,
        startedAt = T0
    )
    ActivityPhase.Tool -> RunTrace(
        status = "running",
        tools = listOf(
            tool("a", "read", "ok", "package.json", 120),
            tool("b", "bash", "running", "pnpm test")
        ),
        reasoning = "Menjalankan tes untuk memastikan perubahan aman.",
        lastActivity = LastActivity.Tool,
        startedAt = T0
    )
    ActivityPhase.Writing -> RunTrace(status = "running", lastActivity = LastActivity.Text, startedAt = T0)
    ActivityPhase.WaitingApproval -> RunTrace(
        status = "waiting_approval",
        tools = listOf(tool("a", "bash", "running", "rm -rf build")),
        approvals = listOf("ap1"),
        startedAt = T0
    )
    ActivityPhase.Done -> RunTrace(
        status = "completed",
        tools = listOf(tool("a", "read", "ok", "src/App.kt", 300), tool("b", "edit", "ok", "src/App.kt", 900)),
        startedAt = T0,
        endedAt = T0 + 8_000,
        lastEventAt = T0 + 8_000
    )
    ActivityPhase.Error -> RunTrace(
        status = "failed",
        tools = listOf(tool("a", "bash", "error", "pnpm build", 4_000)),
        startedAt = T0,
        endedAt = T0 + 5_000,
        lastEventAt = T0 + 5_000
    )
    ActivityPhase.Cancelled -> RunTrace(status = "cancelled", startedAt = T0, endedAt = T0 + 3_000)
}

@Composable
private fun ActivityPreview(content: @Composable () -> Unit) {
    AiosTheme(darkTheme = isSystemInDarkTheme()) {
        Column(
            modifier = Modifier.background(AiosTheme.colors.bg).padding(Tokens.Space.s16),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
        ) { content() }
    }
}

@PreviewLightDark
@Composable
private fun RunActivityPhasesPreview() = ActivityPreview {
    ActivityPhase.entries.forEach { RunActivity(sampleTrace(it)) }
}

/** Skala font 200%: baris aktivitas membungkus, tidak terpotong. */
@PreviewFontScale
@Composable
private fun RunActivityFontScalePreview() = ActivityPreview {
    RunActivity(sampleTrace(ActivityPhase.Tool))
    RunActivity(sampleTrace(ActivityPhase.Done))
}

/** Empat state chat: memuat, kosong, error (coba lagi), sukses (baris aktivitas). */
@PreviewLightDark
@Composable
private fun ChatFourStatesPreview() = ActivityPreview {
    SkeletonList(rows = 2)
    EmptyState(message = "Belum ada pesan.", actionLabel = "Mulai chat", onAction = {})
    ErrorBanner(message = "Chat belum bisa dimuat. Periksa koneksi lalu coba lagi.", onRetry = {})
    RunActivity(sampleTrace(ActivityPhase.Done))
}

@PreviewLightDark
@Composable
private fun ChatWelcomePreview() = ActivityPreview { ChatWelcome(onPick = {}) }
