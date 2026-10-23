package app.aios.android.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import app.aios.android.R
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens
import androidx.compose.ui.res.stringResource

/** Chip kecil untuk role, filter, dan status. Bila [onClick] ada, chip bisa ditekan. */
@Composable
fun AiosChip(text: String, modifier: Modifier = Modifier, selected: Boolean = false, onClick: (() -> Unit)? = null) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val base = modifier
        .let { if (onClick != null) it.minimumInteractiveComponentSize() else it }
        .focusRing(focused, AiosTheme.colors.accent)
        .clip(shape)
        .background(if (selected) colors.accentSoft else colors.surface2)
        .semantics { this.selected = selected }
    val clickable = if (onClick != null) {
        base.clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
    } else {
        base
    }
    Text(
        text = text,
        style = AiosTheme.type.meta,
        color = if (selected) colors.text else colors.text2,
        modifier = clickable.padding(horizontal = Tokens.Space.s8, vertical = Tokens.Space.s4)
    )
}

/** Baris daftar dengan pemisah 1dp di bawah. Tinggi minimum 48dp untuk target sentuh. */
@Composable
fun AiosListItem(
    title: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    trailing: String? = null,
    @DrawableRes leadingIcon: Int? = null,
    selected: Boolean = false,
    trailingContent: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null
) {
    val colors = AiosTheme.colors
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val rowModifier = modifier
        .fillMaxWidth()
        .focusRing(focused, AiosTheme.colors.accent)
        .background(if (selected) colors.accentSoft else Color.Transparent)
        .let {
            if (onClick != null) {
                it.clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
            } else {
                it
            }
        }
        .drawBehind {
            val y = size.height - Hairline.toPx() / 2
            drawLine(colors.border, Offset(0f, y), Offset(size.width, y), Hairline.toPx())
        }
        .defaultMinSize(minHeight = Tokens.touchTarget)
        .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s12)
    Row(
        modifier = rowModifier,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (leadingIcon != null) AiosIcon(id = leadingIcon, contentDescription = null)
        Column(modifier = Modifier.weight(1f)) {
            Text(text = title, style = AiosTheme.type.ui, color = colors.text)
            if (supporting != null) {
                Text(text = supporting, style = AiosTheme.type.meta, color = colors.text2)
            }
        }
        if (trailing != null) {
            Text(text = trailing, style = AiosTheme.type.meta, color = colors.text3)
        }
        trailingContent?.invoke()
    }
}

private const val SKELETON_LOW_ALPHA = 0.5f
private const val SKELETON_PULSE_MS = 900

/** Blok placeholder untuk konten yang sedang dimuat; bentuknya meniru konten, bukan spinner. */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, width: Dp? = null, height: Dp = Tokens.Space.s16) {
    val alpha by rememberInfiniteTransition(label = "skeleton").animateFloat(
        initialValue = 1f,
        targetValue = SKELETON_LOW_ALPHA,
        animationSpec = infiniteRepeatable(tween(SKELETON_PULSE_MS, easing = Tokens.Motion.Easing), RepeatMode.Reverse),
        label = "skeletonAlpha"
    )
    Box(
        modifier = modifier
            .let { if (width != null) it.width(width) else it.fillMaxWidth() }
            .height(height)
            .alpha(alpha)
            .background(AiosTheme.colors.surface2, RoundedCornerShape(Tokens.Radius.sm))
    )
}

/** Skeleton berbentuk daftar: baris dengan judul dan satu baris keterangan. */
@Composable
fun SkeletonList(rows: Int = 5, modifier: Modifier = Modifier) {
    val label = stringResource(R.string.state_loading)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(Tokens.Space.s16)
            .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s20)
    ) {
        repeat(rows) {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                SkeletonBlock(height = Tokens.Space.s16)
                SkeletonBlock(height = Tokens.Space.s12, width = Tokens.Space.s48 * 4)
            }
        }
    }
}

/** Satu kalimat tentang apa yang bisa dilakukan plus satu tombol; tanpa ilustrasi. */
@Composable
fun EmptyState(
    message: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = Tokens.Space.s24, vertical = Tokens.Space.s40),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
    ) {
        Text(text = message, style = AiosTheme.type.ui, color = AiosTheme.colors.text2)
        if (actionLabel != null && onAction != null) {
            AiosButton(text = actionLabel, onClick = onAction, kind = ButtonKind.Secondary)
        }
    }
}

/** Panel error inline: apa yang gagal dan langkah berikutnya; tombol coba lagi bila ada. */
@Composable
fun ErrorBanner(
    message: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null
) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.surface, shape)
            .border(Hairline, colors.danger, shape)
            .padding(Tokens.Space.s12)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12)) {
            AiosIcon(
                R.drawable.ic_alert,
                contentDescription = stringResource(R.string.error_banner_label),
                tint = colors.danger
            )
            Text(text = message, style = AiosTheme.type.ui, color = colors.text, modifier = Modifier.weight(1f))
        }
        if (onRetry != null || onDismiss != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                if (onRetry != null) {
                    AiosButton(stringResource(R.string.state_retry), onRetry, kind = ButtonKind.Secondary)
                }
                if (onDismiss != null) {
                    AiosButton(stringResource(R.string.state_dismiss), onDismiss, kind = ButtonKind.Ghost)
                }
            }
        }
    }
}

/** Pita tipis di atas layar saat offline. */
@Composable
fun OfflineBanner(modifier: Modifier = Modifier) {
    val colors = AiosTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.surface2)
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AiosIcon(R.drawable.ic_wifi_off, contentDescription = null, tint = colors.warning)
        Text(
            text = stringResource(R.string.state_offline_banner),
            style = AiosTheme.type.meta,
            color = colors.text
        )
    }
}
