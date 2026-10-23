package app.aios.android.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

val IconSize = 24.dp

/** Garis pemisah dan border: 1dp. */
val Hairline = 1.dp

/** Ikon garis gaya Lucide dari res/drawable, diwarnai lewat tint. */
@Composable
fun AiosIcon(
    @DrawableRes id: Int,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = AiosTheme.colors.text2
) {
    Icon(
        painter = painterResource(id),
        contentDescription = contentDescription,
        modifier = modifier.size(IconSize),
        tint = tint
    )
}

/**
 * Cincin fokus: 2dp `accent` dengan offset 2dp di luar komponen, hanya saat [focused].
 * Wajib terlihat untuk navigasi keyboard dan D-pad.
 */
fun Modifier.focusRing(focused: Boolean, color: Color, radius: Dp = Tokens.Radius.sm): Modifier {
    return if (!focused) {
        this
    } else {
        drawWithContent {
            drawContent()
            val width = Tokens.Focus.width.toPx()
            val inflate = Tokens.Focus.offset.toPx() + width / 2
            drawRoundRect(
                color = color,
                topLeft = Offset(-inflate, -inflate),
                size = Size(size.width + 2 * inflate, size.height + 2 * inflate),
                cornerRadius = CornerRadius(radius.toPx() + inflate),
                style = Stroke(width = width)
            )
        }
    }
}
