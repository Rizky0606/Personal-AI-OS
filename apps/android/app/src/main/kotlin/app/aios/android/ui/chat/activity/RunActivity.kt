package app.aios.android.ui.chat.activity

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import app.aios.android.R
import app.aios.android.ui.components.AgentOrb
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.OrbSizeCompact
import app.aios.android.ui.components.ShimmerText
import app.aios.android.ui.components.StatusDot
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Di atas skala font ini, baris aktivitas bertumpuk (teks penuh, lalu timer dan kontrol) agar tidak terpotong. */
private const val LARGE_FONT_SCALE = 1.3f
private const val CHEVRON_OPEN_DEGREES = 180f

/**
 * Baris aktivitas run (gaya Claude): judul abu (berkilau saat berjalan), satu baris ringkas (Orb kecil, label,
 * target redup, timer, +N, chevron) yang bisa dibuka menjadi linimasa langkah, dan ringkasan setelah selesai.
 * Terbuka sendiri saat ada galat atau menunggu izin. Timer memakai satu ticker bersama ([rememberClockNow]),
 * dibaca hanya oleh teks timer dan baris langkah yang berjalan; run yang sudah selesai tidak berlangganan.
 */
@Composable
fun RunActivity(trace: RunTrace, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val texts = remember(context) { ResourceActivityTexts(context.resources, context.packageName) }
    val activity = remember(trace, texts) { buildActivity(trace, System.currentTimeMillis(), texts) }
    val clock: State<Long>? = if (trace.settled) null else rememberClockNow()
    var expanded by rememberSaveable { mutableStateOf(activity.needsAttention) }
    LaunchedEffect(activity.needsAttention) { if (activity.needsAttention) expanded = true }
    val motion = AiosTheme.motion

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
        activity.headline?.let { Headline(it, running = clock != null) }
        ActivityRow(
            trace = trace,
            activity = activity,
            clock = clock,
            texts = texts,
            expanded = expanded,
            onToggle = { expanded = !expanded }
        )
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(motion.base()) + fadeIn(motion.base()),
            exit = shrinkVertically(motion.base()) + fadeOut(motion.fast())
        ) {
            Timeline(activity = activity, clock = clock, texts = texts)
        }
    }
}

/** Judul abu dari penalaran. Satu-satunya bagian yang diumumkan (live region sopan) saat berubah. */
@Composable
private fun Headline(text: String, running: Boolean) {
    val modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
    if (running) {
        ShimmerText(text = text, modifier = modifier)
    } else {
        Text(text = text, style = AiosTheme.type.meta, color = AiosTheme.colors.text3, modifier = modifier)
    }
}

@Composable
private fun ActivityRow(
    trace: RunTrace,
    activity: Activity,
    clock: State<Long>?,
    texts: ActivityTexts,
    expanded: Boolean,
    onToggle: () -> Unit
) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md)
    val phase = activity.phase.toAgentPhase()
    val phaseLabel = stringResource(activity.phase.labelRes())
    val label = activity.summary ?: activity.current?.label ?: phaseLabel
    val description = stringResource(R.string.activity_row_label, label)
    val stateText =
        stringResource(if (expanded) R.string.activity_state_expanded else R.string.activity_state_collapsed)
    val large = LocalDensity.current.fontScale > LARGE_FONT_SCALE

    val body: @Composable RowScope.() -> Unit = {
        val text = buildAnnotatedString {
            append(label)
            val target = if (activity.summary == null) activity.current?.target else null
            if (target != null) {
                append("  ")
                withStyle(SpanStyle(color = colors.text3)) { append(target) }
            }
        }
        Text(
            text = text,
            style = AiosTheme.type.ui,
            color = colors.text,
            // Skala font besar: teks boleh membungkus; skala normal: satu baris.
            maxLines = if (large) Int.MAX_VALUE else 1,
            overflow = TextOverflow.Ellipsis,
            modifier = if (large) Modifier else Modifier.weight(1f)
        )
    }
    val trailing: @Composable () -> Unit = {
        if (activity.summary == null) ElapsedText(trace, activity, clock, texts)
        if (activity.hiddenCount > 0) {
            Text(
                text = stringResource(R.string.activity_more_steps, activity.hiddenCount),
                style = AiosTheme.type.meta,
                color = colors.text3
            )
        }
        val rotation by animateFloatAsState(
            if (expanded) CHEVRON_OPEN_DEGREES else 0f,
            AiosTheme.motion.base(),
            label = "activityChevron"
        )
        AiosIcon(R.drawable.ic_chevron_down, contentDescription = null, modifier = Modifier.rotate(rotation))
    }

    val base = Modifier
        .fillMaxWidth()
        .heightIn(min = Tokens.touchTarget)
        .clip(shape)
        .background(colors.surface2, shape)
        .border(app.aios.android.ui.components.Hairline, colors.border, shape)
        .clickable(role = Role.Button, onClick = onToggle)
        // Dibacakan sebagai satu kontrol dengan keadaan buka/tutup; timer sengaja tidak ikut diumumkan.
        .semantics(mergeDescendants = true) {
            contentDescription = description
            stateDescription = stateText
        }
        .padding(horizontal = Tokens.Space.s12, vertical = Tokens.Space.s8)

    if (large) {
        Column(modifier = base, verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                AgentOrb(phase, size = OrbSizeCompact)
                body()
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
            ) { trailing() }
        }
    } else {
        Row(
            modifier = base,
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
        ) {
            AgentOrb(phase, size = OrbSizeCompact)
            body()
            trailing()
        }
    }
}

/** Timer berjalan (dari ticker bersama) atau total akhir; tidak diumumkan pembaca layar. */
@Composable
private fun ElapsedText(trace: RunTrace, activity: Activity, clock: State<Long>?, texts: ActivityTexts) {
    val elapsed = if (clock == null) {
        activity.elapsedMs
    } else {
        trace.startedAt?.let { maxOf(0L, clock.value - it) } ?: 0L
    }
    Text(
        text = formatElapsed(texts, elapsed),
        style = AiosTheme.type.meta,
        color = AiosTheme.colors.text3,
        modifier = Modifier.clearAndSetSemantics { }
    )
}

@Composable
private fun Timeline(activity: Activity, clock: State<Long>?, texts: ActivityTexts) {
    val colors = AiosTheme.colors
    var showAll by rememberSaveable { mutableStateOf(false) }
    val shown = if (showAll) activity.steps else activity.steps.takeLast(DEFAULT_VISIBLE_STEPS)
    Column(
        modifier = Modifier.fillMaxWidth().padding(start = Tokens.Space.s8),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
    ) {
        if (activity.hiddenCount > 0 && !showAll) {
            Text(
                text = stringResource(R.string.activity_hidden_steps, activity.hiddenCount),
                style = AiosTheme.type.meta,
                color = colors.text2,
                modifier = Modifier
                    .heightIn(min = Tokens.touchTarget)
                    .clickable(role = Role.Button) { showAll = true }
                    .padding(vertical = Tokens.Space.s12)
            )
        }
        shown.forEach { step -> key(step.id) { StepRow(step, clock, texts) } }
    }
}

private fun stepPhase(status: String): AgentPhase = when (status) {
    "running" -> AgentPhase.Tool
    "ok" -> AgentPhase.Done
    "error" -> AgentPhase.Error
    else -> AgentPhase.Idle
}

@Composable
private fun StepRow(step: ActivityStep, clock: State<Long>?, texts: ActivityTexts) {
    val colors = AiosTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = Tokens.Space.s32),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
        verticalAlignment = Alignment.CenterVertically
    ) {
        StatusDot(stepPhase(step.status))
        Column(modifier = Modifier.weight(1f)) {
            Text(text = step.label, style = AiosTheme.type.ui, color = colors.text)
            step.target?.let {
                Text(text = it, style = AiosTheme.type.mono, color = colors.text3)
            }
        }
        StepDuration(step, clock, texts)
    }
}

@Composable
private fun StepDuration(step: ActivityStep, clock: State<Long>?, texts: ActivityTexts) {
    val ms = if (step.status == "running") {
        val start = step.startedAt
        if (clock != null && start != null) maxOf(0L, clock.value - start) else step.durationMs
    } else {
        step.durationMs
    }
    if (ms != null) {
        Text(
            text = formatElapsed(texts, ms),
            style = AiosTheme.type.meta,
            color = AiosTheme.colors.text3,
            modifier = Modifier.clearAndSetSemantics { }
        )
    }
}
