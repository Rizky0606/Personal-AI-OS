package app.aios.android.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import app.aios.android.ui.theme.AiosTheme

/*
 * Efek visual (DESIGN_SYSTEM.md: Efek): gradien satu warna aksen, cahaya aksen, dan sapuan item aktif.
 * Hanya dari warna aksen; tanpa blur kaca dan gradien multiwarna.
 */

private const val ACCENT_SHIFT = 0.14f
private const val WASH_ALPHA = 0.22f
private const val GLOW_ALPHA = 0.55f
private const val DARK_LUMINANCE = 0.5f
private val GLOW_ELEVATION = 10.dp

/** Tema gelap menurut latar aplikasi (AiosTheme tidak menyimpan mode). */
@Composable
@ReadOnlyComposable
fun isDarkSurface(): Boolean = AiosTheme.colors.bg.luminance() < DARK_LUMINANCE

/**
 * Gradien tombol primer: aksen ke aksen yang lebih gelap (tema terang, teks putih) atau lebih terang (tema
 * gelap, teks gelap), supaya kontras teks tidak turun.
 */
@Composable
@ReadOnlyComposable
fun accentGradient(): Brush {
    val accent = AiosTheme.colors.accent
    val end = lerp(accent, if (isDarkSurface()) Color.White else Color.Black, ACCENT_SHIFT)
    return Brush.linearGradient(listOf(accent, end))
}

/** Sapuan aksen untuk item aktif: memudar ke kanan. */
@Composable
@ReadOnlyComposable
fun activeWash(): Brush =
    Brush.horizontalGradient(listOf(AiosTheme.colors.accent.copy(alpha = WASH_ALPHA), Color.Transparent))

/** Cahaya aksen di sekitar elemen (bayangan berwarna; warna diabaikan di bawah Android 9). */
@Composable
fun Modifier.accentGlow(shape: Shape, enabled: Boolean = true): Modifier {
    if (!enabled) return this
    val glow = AiosTheme.colors.accent.copy(alpha = GLOW_ALPHA)
    return shadow(GLOW_ELEVATION, shape, clip = false, ambientColor = glow, spotColor = glow)
}
