package app.aios.android.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.rememberLoopFloat
import app.aios.ui.tokens.Tokens

private const val SHIMMER_CYCLE_MS = Tokens.Motion.LoopMinMs
private const val SWEEP_PX = 420f

/** Posisi awal sapuan (px) untuk [progress] 0..1: dari kiri di luar bidang ke kanan di luar bidang. */
internal fun shimmerStart(progress: Float, sweepPx: Float = SWEEP_PX): Float = (progress * 2f - 1f) * sweepPx

/**
 * Kuas berkilau: [base] dengan sapuan [highlight] yang bergerak. Bila animasi dimatikan sistem, kuas polos
 * [base] (tanpa gerak).
 */
@Composable
fun rememberShimmerBrush(base: Color, highlight: Color): Brush {
    val progress = rememberLoopFloat(
        initial = 0f,
        target = 1f,
        cycleMs = SHIMMER_CYCLE_MS,
        rest = 0f,
        label = "shimmer",
        mode = RepeatMode.Restart
    )
    if (!AiosTheme.motion.decorative) return SolidColor(base)
    val start = shimmerStart(progress)
    return Brush.linearGradient(
        colors = listOf(base, highlight, base),
        start = Offset(start, 0f),
        end = Offset(start + SWEEP_PX, 0f)
    )
}

/** Teks berkilau untuk status "sedang bekerja" (mis. "Menalar…"); polos bila animasi dimatikan. */
@Composable
fun ShimmerText(text: String, modifier: Modifier = Modifier, style: TextStyle = AiosTheme.type.meta) {
    val colors = AiosTheme.colors
    val brush = rememberShimmerBrush(base = colors.text2, highlight = colors.text)
    Text(text = text, style = style.copy(brush = brush), modifier = modifier)
}

/** Latar kerangka (skeleton) yang berkilau antara lapisan surface2 dan surface3. */
@Composable
fun Modifier.shimmerBackground(shape: Shape): Modifier {
    val colors = AiosTheme.colors
    val brush = rememberShimmerBrush(base = colors.surface2, highlight = colors.surface3)
    return background(brush, shape)
}
