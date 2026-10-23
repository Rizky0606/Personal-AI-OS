package app.aios.android.ui.chat

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import app.aios.android.R
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.focusRing
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

private const val MAX_LINES = 6
private const val DISABLED_ALPHA = 0.5f

/**
 * Composer menempel di bawah dan naik bersama keyboard (pemanggil memasang `imePadding`).
 * Tombol kirim berubah menjadi hentikan saat jawaban mengalir.
 */
@Composable
fun Composer(
    draft: String,
    onDraft: (String) -> Unit,
    streaming: Boolean,
    sending: Boolean,
    modelLabel: String,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onPickModel: () -> Unit,
    voice: VoiceInputState,
    modifier: Modifier = Modifier
) {
    val colors = AiosTheme.colors
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Tokens.Radius.md)
    val canSend = draft.isNotBlank() && !sending
    val composerLabel = stringResource(R.string.chat_composer_label)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.bg)
            .drawBehind {
                drawLine(
                    colors.border,
                    Offset(0f, Hairline.toPx() / 2),
                    Offset(size.width, Hairline.toPx() / 2),
                    Hairline.toPx()
                )
            }
            .padding(horizontal = Tokens.Space.s12, vertical = Tokens.Space.s8),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        AiosChip(
            text = modelLabel,
            onClick = onPickModel,
            modifier = Modifier.semantics { contentDescription = modelLabel }
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
            verticalAlignment = Alignment.Bottom
        ) {
            MicButton(voice)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .focusRing(focused, colors.accent, Tokens.Radius.md)
                    .defaultMinSize(minHeight = Tokens.touchTarget)
                    .background(colors.surface, shape)
                    .border(Hairline, if (focused) colors.borderStrong else colors.border, shape)
                    .padding(horizontal = Tokens.Space.s12, vertical = Tokens.Space.s12),
                contentAlignment = Alignment.CenterStart
            ) {
                BasicTextField(
                    value = draft,
                    onValueChange = onDraft,
                    maxLines = MAX_LINES,
                    textStyle = AiosTheme.type.chat.copy(color = colors.text),
                    cursorBrush = SolidColor(colors.accent),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = ImeAction.Default
                    ),
                    interactionSource = source,
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = composerLabel },
                    decorationBox = { inner ->
                        if (draft.isEmpty()) {
                            Text(
                                text = stringResource(
                                    if (voice.listening) R.string.chat_voice_listening else R.string.chat_composer_hint
                                ),
                                style = AiosTheme.type.chat,
                                color = colors.text3
                            )
                        }
                        inner()
                    }
                )
            }
            if (streaming) {
                ActionButton(
                    icon = R.drawable.ic_stop,
                    description = stringResource(R.string.chat_stop),
                    primary = false,
                    enabled = true,
                    onClick = onStop
                )
            } else {
                ActionButton(
                    icon = R.drawable.ic_arrow_up,
                    description = stringResource(R.string.chat_send),
                    primary = true,
                    enabled = canSend,
                    onClick = onSend
                )
            }
        }
    }
}

/** Tombol ikon 48dp: kirim (aksen, aksi utama layar) atau hentikan (netral). */
@Composable
private fun ActionButton(icon: Int, description: String, primary: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md)
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Box(
        modifier = Modifier
            .size(Tokens.touchTarget)
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .focusRing(focused, colors.accent, Tokens.Radius.md)
            .clip(shape)
            .background(if (primary) colors.accent else colors.surface2)
            .clickable(
                interactionSource = source,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onClick = onClick
            ),
        contentAlignment = Alignment.Center
    ) {
        AiosIcon(icon, contentDescription = description, tint = if (primary) AiosTheme.onAccent else colors.text)
    }
}

/**
 * Tahan untuk bicara, lepas untuk berhenti. TalkBack tidak bisa menahan, jadi ada aksi klik semantik
 * yang bergantian memulai dan menghentikan.
 */
@Composable
private fun MicButton(voice: VoiceInputState) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md)
    val label = stringResource(if (voice.listening) R.string.chat_voice_stop else R.string.chat_voice_hold)
    Box(
        modifier = Modifier
            .size(Tokens.touchTarget)
            .clip(shape)
            .background(if (voice.listening) colors.accentSoft else colors.surface2)
            .border(Hairline, if (voice.listening) colors.accent else colors.border, shape)
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        voice.start()
                        tryAwaitRelease()
                        voice.stop()
                    }
                )
            }
            .semantics {
                contentDescription = label
                onClick(label = label) {
                    if (voice.listening) voice.stop() else voice.start()
                    true
                }
            },
        contentAlignment = Alignment.Center
    ) {
        AiosIcon(
            R.drawable.ic_mic,
            contentDescription = null,
            tint = if (voice.listening) colors.accent else colors.text
        )
    }
}
