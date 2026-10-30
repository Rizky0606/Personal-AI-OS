@file:Suppress("UnusedPrivateMember") // fungsi @Preview dipanggil oleh Android Studio, bukan kode

package app.aios.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.PreviewLightDark
import app.aios.android.R
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Pembungkus preview: tema mengikuti mode preview (terang atau gelap) dan latar `bg`. */
@Composable
internal fun AiosPreview(content: @Composable () -> Unit) {
    AiosTheme(darkTheme = isSystemInDarkTheme()) {
        Column(
            modifier = Modifier.background(AiosTheme.colors.bg).padding(Tokens.Space.s16),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
        ) { content() }
    }
}

@PreviewLightDark
@Composable
private fun AgentOrbPreview() = AiosPreview {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s16),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AgentPhase.entries.forEach { AgentOrb(it, size = OrbSizeFull) }
    }
    Row(
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s16),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AgentPhase.entries.forEach { AgentOrb(it, size = OrbSizeCompact) }
    }
}

@PreviewLightDark
@Composable
private fun StatusDotPreview() = AiosPreview {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s16),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AgentPhase.entries.forEach { StatusDot(it) }
    }
}

@PreviewLightDark
@Composable
private fun ShimmerTextPreview() = AiosPreview {
    ShimmerText("Menalar…")
    ShimmerText("Menjalankan perintah", style = AiosTheme.type.ui)
    SkeletonList(rows = 2)
}

@PreviewLightDark
@Composable
private fun FloatingNavBarPreview() = AiosPreview {
    val items = listOf(
        NavBarItem("chat", R.drawable.ic_chat, "Chat"),
        NavBarItem("research", R.drawable.ic_research, "Riset"),
        NavBarItem("schedules", R.drawable.ic_schedule, "Jadwal"),
        NavBarItem("spaces", R.drawable.ic_library, "Ruang")
    )
    FloatingNavBar(items = items, selectedKey = "research", onSelect = {})
}

@PreviewLightDark
@Composable
private fun ScreenStatesPreview() = AiosPreview {
    SkeletonList(rows = 2)
    EmptyState(message = "Belum ada data.", actionLabel = "Buat baru", onAction = {})
    ErrorBanner(message = "Tidak bisa memuat. Periksa koneksi lalu coba lagi.", onRetry = {})
}
