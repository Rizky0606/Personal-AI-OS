package app.aios.android.ui.chat

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import app.aios.android.R
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.accentGlow
import app.aios.android.ui.components.accentGradient
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens
import kotlinx.coroutines.delay

private class WelcomeCard(
    @StringRes val title: Int,
    @StringRes val hint: Int,
    @StringRes val prompt: Int,
    @DrawableRes val icon: Int
)

private val CARDS = listOf(
    WelcomeCard(
        R.string.chat_welcome_summary,
        R.string.chat_welcome_summary_hint,
        R.string.chat_welcome_summary_prompt,
        R.drawable.ic_copy
    ),
    WelcomeCard(
        R.string.chat_welcome_error,
        R.string.chat_welcome_error_hint,
        R.string.chat_welcome_error_prompt,
        R.drawable.ic_alert
    ),
    WelcomeCard(
        R.string.chat_welcome_email,
        R.string.chat_welcome_email_hint,
        R.string.chat_welcome_email_prompt,
        R.drawable.ic_pencil
    ),
    WelcomeCard(
        R.string.chat_welcome_code,
        R.string.chat_welcome_code_hint,
        R.string.chat_welcome_code_prompt,
        R.drawable.ic_terminal
    )
)

/** Jeda antar kartu saat muncul bertahap (maksimal 4 elemen × 40 ms). */
private const val STAGGER_MS = 40
private const val RISE_PX = 24f
private const val ORB_MIN_SCALE = 1f
private const val ORB_MAX_SCALE = 1.08f
private const val ORB_MIN_ALPHA = 0.75f
private const val ORB_CYCLE_MS = 1800
private const val PRESSED_SCALE = 0.98f
private const val ORB_INNER_ALPHA = 0.6f
private const val ORB_MID_ALPHA = 0.18f

/**
 * Sambutan chat kosong: cahaya aksen yang bernapas, satu kalimat kerja, dan kartu saran yang muncul bertahap.
 * Kartu hanya mengisi kolom pesan; composer tetap di bawah.
 */
@Composable
fun ChatWelcome(onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Tokens.Space.s24, vertical = Tokens.Space.s32),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16, Alignment.CenterVertically)
    ) {
        WelcomeOrb()
        Rise(index = 0) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
            ) {
                Text(
                    text = stringResource(R.string.chat_welcome_title),
                    style = AiosTheme.type.page,
                    color = AiosTheme.colors.text,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { heading() }
                )
                Text(
                    text = stringResource(R.string.chat_welcome_subtitle),
                    style = AiosTheme.type.ui,
                    color = AiosTheme.colors.text2,
                    textAlign = TextAlign.Center
                )
            }
        }
        CARDS.forEachIndexed { index, card ->
            val prompt = stringResource(card.prompt)
            Rise(index = index + 1) { SuggestionCard(card, onClick = { onPick(prompt) }) }
        }
    }
}

/** Titik aksen bergradien dengan cahaya yang membesar dan meredup pelan. */
@Composable
private fun WelcomeOrb() {
    val accent = AiosTheme.colors.accent
    val transition = rememberInfiniteTransition(label = "orb")
    val scale by transition.animateFloat(
        ORB_MIN_SCALE,
        ORB_MAX_SCALE,
        infiniteRepeatable(tween(ORB_CYCLE_MS, easing = Tokens.Motion.Easing), RepeatMode.Reverse),
        label = "orbScale"
    )
    val alpha by transition.animateFloat(
        ORB_MIN_ALPHA,
        1f,
        infiniteRepeatable(tween(ORB_CYCLE_MS, easing = Tokens.Motion.Easing), RepeatMode.Reverse),
        label = "orbAlpha"
    )
    Box(modifier = Modifier.size(Tokens.Space.s48 * 2), contentAlignment = Alignment.Center) {
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    this.alpha = alpha
                }
        ) {
            drawCircle(
                Brush.radialGradient(
                    0f to accent.copy(alpha = ORB_INNER_ALPHA),
                    0.45f to accent.copy(alpha = ORB_MID_ALPHA),
                    1f to Color.Transparent
                )
            )
        }
        Box(
            Modifier
                .size(Tokens.Space.s12)
                .accentGlow(CircleShape)
                .background(accentGradient(), CircleShape)
        )
    }
}

/** Muncul naik dengan pegas ringan, tertunda sesuai urutan (stagger pendek). */
@Composable
private fun Rise(index: Int, content: @Composable () -> Unit) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay((index * STAGGER_MS).toLong())
        progress.animateTo(1f, tween(Tokens.Motion.EmphasisMs, easing = Tokens.Motion.Spring))
    }
    Box(
        Modifier.graphicsLayer {
            alpha = progress.value.coerceIn(0f, 1f)
            translationY = (1f - progress.value) * RISE_PX
        }
    ) { content() }
}

@Composable
private fun SuggestionCard(card: WelcomeCard, onClick: () -> Unit) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.lg)
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed) PRESSED_SCALE else 1f,
        tween(Tokens.Motion.FastMs, easing = Tokens.Motion.Spring),
        label = "cardScale"
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .background(colors.surface, shape)
            .border(Hairline, if (pressed) colors.borderStrong else colors.border, shape)
            .clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
            .padding(Tokens.Space.s12),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(Tokens.Space.s32)
                .background(if (pressed) colors.accentSoft else colors.surface2, RoundedCornerShape(Tokens.Radius.md)),
            contentAlignment = Alignment.Center
        ) { AiosIcon(card.icon, contentDescription = null, tint = colors.text2) }
        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4 / 2)) {
            Text(stringResource(card.title), style = AiosTheme.type.ui, color = colors.text)
            Text(stringResource(card.hint), style = AiosTheme.type.meta, color = colors.text2)
        }
    }
}
