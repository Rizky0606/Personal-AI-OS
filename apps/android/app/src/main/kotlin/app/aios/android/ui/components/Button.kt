package app.aios.android.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

enum class ButtonKind {
    /** Satu per area: aksi utama. */
    Primary,
    Secondary,
    Ghost,
    Danger
}

private const val DISABLED_ALPHA = 0.5f

@Composable
fun AiosButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.Secondary,
    enabled: Boolean = true,
    leadingIcon: (@Composable () -> Unit)? = null
) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val focused by source.collectIsFocusedAsState()

    val base = when (kind) {
        ButtonKind.Primary -> colors.accent
        ButtonKind.Secondary -> colors.surface
        ButtonKind.Ghost -> Color.Transparent
        ButtonKind.Danger -> colors.surface
    }
    val pressedColor = when (kind) {
        ButtonKind.Primary -> colors.accent.copy(alpha = PRESSED_ACCENT_ALPHA)
        else -> colors.surface2
    }
    val container by animateColorAsState(
        targetValue = if (pressed && enabled) pressedColor else base,
        animationSpec = AiosTheme.motion.fast(),
        label = "buttonContainer"
    )
    val content = when (kind) {
        ButtonKind.Primary -> AiosTheme.onAccent
        ButtonKind.Danger -> colors.danger
        else -> colors.text
    }
    val border = when (kind) {
        ButtonKind.Secondary -> BorderStroke(Hairline, colors.borderStrong)
        ButtonKind.Danger -> BorderStroke(Hairline, colors.danger)
        else -> null
    }

    Row(
        modifier = modifier
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .focusRing(focused, AiosTheme.colors.accent)
            .defaultMinSize(minHeight = Tokens.touchTarget)
            .clip(shape)
            .background(container)
            .then(if (border != null) Modifier.border(border, shape) else Modifier)
            .clickable(
                interactionSource = source,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onClick = onClick
            )
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s12),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically
    ) {
        leadingIcon?.invoke()
        Text(
            text = text,
            style = AiosTheme.type.uiStrong,
            color = content,
            textAlign = TextAlign.Center
        )
    }
}

private const val PRESSED_ACCENT_ALPHA = 0.85f
