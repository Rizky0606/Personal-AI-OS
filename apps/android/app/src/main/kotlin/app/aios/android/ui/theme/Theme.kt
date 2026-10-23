package app.aios.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import app.aios.android.data.settings.ThemeMode
import app.aios.ui.tokens.AiosColors
import app.aios.ui.tokens.Tokens

private val LocalAiosColors = staticCompositionLocalOf { Tokens.lightColors }
private val LocalAiosTypography = staticCompositionLocalOf { AiosTypography.Default }
private val LocalOnAccent = staticCompositionLocalOf { Tokens.lightColors.surface }

/** Akses ke token desain dari komposisi mana pun: `AiosTheme.colors.accent`, `AiosTheme.type.ui`. */
object AiosTheme {
    val colors: AiosColors
        @Composable @ReadOnlyComposable
        get() = LocalAiosColors.current

    val type: AiosTypography
        @Composable @ReadOnlyComposable
        get() = LocalAiosTypography.current

    /** Warna teks di atas `accent`: putih di tema terang, `bg` di tema gelap (kontras AA di keduanya). */
    val onAccent: Color
        @Composable @ReadOnlyComposable
        get() = LocalOnAccent.current
}

@Composable
fun isDarkTheme(mode: ThemeMode): Boolean = when (mode) {
    ThemeMode.System -> isSystemInDarkTheme()
    ThemeMode.Light -> false
    ThemeMode.Dark -> true
}

/** Dynamic color Material You sengaja tidak dipakai agar identitas visual tetap konsisten. */
@Composable
fun AiosTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    val colors = if (darkTheme) Tokens.darkColors else Tokens.lightColors
    val onAccent = if (darkTheme) colors.bg else colors.surface
    val typography = AiosTypography.Default
    CompositionLocalProvider(
        LocalAiosColors provides colors,
        LocalAiosTypography provides typography,
        LocalOnAccent provides onAccent
    ) {
        MaterialTheme(
            colorScheme = colors.toMaterial(darkTheme, onAccent),
            typography = typography.toMaterial(),
            shapes = Shapes(
                extraSmall = RoundedCornerShape(Tokens.Radius.sm),
                small = RoundedCornerShape(Tokens.Radius.sm),
                medium = RoundedCornerShape(Tokens.Radius.md),
                large = RoundedCornerShape(Tokens.Radius.lg),
                extraLarge = RoundedCornerShape(Tokens.Radius.lg)
            ),
            content = content
        )
    }
}

private fun AiosColors.toMaterial(dark: Boolean, onAccent: Color): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = accentSoft,
        onPrimaryContainer = text,
        secondary = text2,
        onSecondary = bg,
        background = bg,
        onBackground = text,
        surface = surface,
        onSurface = text,
        surfaceVariant = surface2,
        onSurfaceVariant = text2,
        surfaceContainerLowest = surface,
        surfaceContainerLow = surface,
        surfaceContainer = surface,
        surfaceContainerHigh = surface2,
        surfaceContainerHighest = surface2,
        outline = borderStrong,
        outlineVariant = border,
        error = danger,
        onError = onAccent
    )
}
