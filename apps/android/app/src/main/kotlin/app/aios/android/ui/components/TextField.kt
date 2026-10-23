package app.aios.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/**
 * Field satu baris: label di atas, border tipis (lebih tegas saat aktif), pesan bantu atau error di bawah.
 * Error selalu disertai teks, bukan hanya warna.
 */
@Composable
fun AiosTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    supportingText: String? = null,
    errorText: String? = null,
    enabled: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailing: (@Composable () -> Unit)? = null,
    singleLine: Boolean = true,
    maxLines: Int = 6
) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val borderColor = when {
        errorText != null -> colors.danger
        focused -> colors.borderStrong
        else -> colors.border
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(text = label, style = AiosTheme.type.meta, color = colors.text2)
        Row(
            modifier = Modifier
                .padding(top = Tokens.Space.s4)
                .fillMaxWidth()
                .focusRing(focused, AiosTheme.colors.accent)
                .defaultMinSize(minHeight = Tokens.touchTarget)
                .background(colors.surface, shape)
                .border(Hairline, borderColor, shape)
                .padding(horizontal = Tokens.Space.s12),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(modifier = Modifier.weight(1f)) {
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    enabled = enabled,
                    singleLine = singleLine,
                    maxLines = if (singleLine) 1 else maxLines,
                    textStyle = AiosTheme.type.ui.copy(color = colors.text),
                    cursorBrush = SolidColor(colors.accent),
                    keyboardOptions = keyboardOptions,
                    keyboardActions = keyboardActions,
                    visualTransformation = visualTransformation,
                    interactionSource = source,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = Tokens.Space.s12)
                        .semantics {
                            contentDescription = label
                            if (errorText != null) error(errorText)
                        },
                    decorationBox = { inner ->
                        if (value.isEmpty() && placeholder != null) {
                            Text(text = placeholder, style = AiosTheme.type.ui, color = colors.text3)
                        }
                        inner()
                    }
                )
            }
            trailing?.invoke()
        }
        val note = errorText ?: supportingText
        if (note != null) {
            Text(
                text = note,
                style = AiosTheme.type.caption,
                color = if (errorText != null) colors.danger else colors.text3,
                modifier = Modifier.padding(top = Tokens.Space.s4)
            )
        }
    }
}
