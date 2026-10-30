package app.aios.android.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.isActive
import app.aios.android.ui.theme.phase
import app.aios.android.ui.theme.rememberLoopFloat
import app.aios.ui.tokens.Tokens

/** Ukuran penuh Orb (dp); ukuran ringkas untuk baris dan kartu adalah 16 dp. */
val OrbSizeFull = 28.dp
val OrbSizeCompact = 16.dp

private const val GRID = 28f
private const val RING_RADIUS = 10f
private const val DOT_RADIUS = 4f
private const val STROKE = 2f
private const val DOT_ALPHA = 0.8f
private const val SPIN_CYCLE_MS = Tokens.Motion.LoopMinMs
private const val SPIN_SWEEP = 270f
private const val FULL_SWEEP = 360f
private const val DEGREES_PER_TURN = 360f

/** Bentuk Orb per fase, terpisah dari menggambar supaya pemetaannya bisa diuji. */
internal data class OrbVisual(
    val dotScale: Float,
    val spinning: Boolean,
    val showCheck: Boolean,
    val showAlert: Boolean
)

internal fun orbVisualOf(phase: AgentPhase): OrbVisual = when (phase) {
    AgentPhase.Idle -> OrbVisual(dotScale = 0.75f, spinning = false, showCheck = false, showAlert = false)
    AgentPhase.Thinking -> OrbVisual(dotScale = 1f, spinning = true, showCheck = false, showAlert = false)
    AgentPhase.Tool -> OrbVisual(dotScale = 1.25f, spinning = false, showCheck = false, showAlert = false)
    AgentPhase.Writing -> OrbVisual(dotScale = 1.5f, spinning = false, showCheck = false, showAlert = false)
    AgentPhase.Done -> OrbVisual(dotScale = 0.4f, spinning = false, showCheck = true, showAlert = false)
    AgentPhase.Error -> OrbVisual(dotScale = 0.4f, spinning = false, showCheck = false, showAlert = true)
}

/**
 * Indikator kerja agent (Canvas): cincin dan titik yang berganti bentuk dan warna antar fase (morph
 * [Tokens.Motion.EmphasisMs]). Thinking memutar busur; Done menggambar centang; Error menggambar tanda seru.
 * Dekoratif: tidak dibacakan pembaca layar kecuali [contentDescription] diberikan. Animasi dekoratif (putar)
 * berhenti bila animasi dimatikan sistem.
 */
@Composable
fun AgentOrb(
    phase: AgentPhase,
    modifier: Modifier = Modifier,
    size: Dp = OrbSizeFull,
    contentDescription: String? = null
) {
    val motion = AiosTheme.motion
    val visual = orbVisualOf(phase)
    val color by animateColorAsState(AiosTheme.colors.phase(phase).fg, motion.emphasis(), label = "orbColor")
    val dot by animateFloatAsState(visual.dotScale, motion.emphasis(), label = "orbDot")
    val check by animateFloatAsState(if (visual.showCheck) 1f else 0f, motion.emphasis(), label = "orbCheck")
    val alert by animateFloatAsState(if (visual.showAlert) 1f else 0f, motion.emphasis(), label = "orbAlert")
    val sweep by animateFloatAsState(
        if (visual.spinning) SPIN_SWEEP else FULL_SWEEP,
        motion.emphasis(),
        label = "orbSweep"
    )
    val spin = if (visual.spinning) {
        rememberLoopFloat(0f, DEGREES_PER_TURN, SPIN_CYCLE_MS, rest = 0f, label = "orbSpin", mode = RepeatMode.Restart)
    } else {
        0f
    }
    val described = if (contentDescription != null) {
        Modifier.semantics {
            this.contentDescription = contentDescription
        }
    } else {
        Modifier
    }
    Canvas(modifier = modifier.size(size).then(described)) {
        val unit = this.size.minDimension / GRID
        val center = Offset(this.size.width / 2, this.size.height / 2)
        val stroke = Stroke(width = STROKE * unit, cap = StrokeCap.Round)
        drawArc(
            color = color,
            startAngle = spin,
            sweepAngle = sweep,
            useCenter = false,
            topLeft = Offset(center.x - RING_RADIUS * unit, center.y - RING_RADIUS * unit),
            size = androidx.compose.ui.geometry.Size(RING_RADIUS * 2 * unit, RING_RADIUS * 2 * unit),
            style = stroke
        )
        drawCircle(color.copy(alpha = DOT_ALPHA), radius = DOT_RADIUS * dot * unit, center = center)
        if (check > 0f) {
            val path = Path().apply {
                moveTo(8f * unit, 14f * unit)
                lineTo(12f * unit, 18f * unit)
                lineTo(20f * unit, 9f * unit)
            }
            val partial = Path()
            val measure = PathMeasure().apply { setPath(path, false) }
            measure.getSegment(0f, measure.length * check, partial, true)
            drawPath(partial, color, style = stroke)
        }
        if (alert > 0f) {
            drawLine(
                color.copy(alpha = alert),
                Offset(center.x, 8f * unit),
                Offset(center.x, 15f * unit),
                strokeWidth = STROKE * unit,
                cap = StrokeCap.Round
            )
            drawCircle(color.copy(alpha = alert), radius = 1.2f * unit, center = Offset(center.x, 19.5f * unit))
        }
    }
}

private const val DOT_PULSE_LOW = 0.4f
private const val DOT_PULSE_MS = Tokens.Motion.LoopMinMs

/**
 * Titik status kecil berwarna token status. Fase aktif berdenyut selama animasi dekoratif diizinkan.
 * Warna bukan satu-satunya penanda: beri [label] (teks status) bila titik berdiri sendiri.
 */
@Composable
fun StatusDot(phase: AgentPhase, modifier: Modifier = Modifier, size: Dp = Tokens.Space.s8, label: String? = null) {
    val alpha = if (phase.isActive) {
        rememberLoopFloat(1f, DOT_PULSE_LOW, DOT_PULSE_MS, rest = 1f, label = "statusDot")
    } else {
        1f
    }
    val described = if (label != null) Modifier.semantics { contentDescription = label } else Modifier
    Box(
        modifier = modifier
            .size(size)
            .alpha(alpha)
            .background(AiosTheme.colors.phase(phase).fg, CircleShape)
            .then(described)
    )
}
