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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.text.style.TextOverflow
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
    modifier: Modifier = Modifier,
    attachments: List<PendingAttachment> = emptyList(),
    onAttach: (() -> Unit)? = null,
    onRemoveAttachment: (String) -> Unit = {}
) {
    val colors = AiosTheme.colors
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Tokens.Radius.md)
    val uploading = attachments.any { it.uploading }
    val hasFiles = attachments.any { it.part != null }
    val canSend = (draft.isNotBlank() || hasFiles) && !sending && !uploading
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            AiosChip(
                text = modelLabel,
                onClick = onPickModel,
                modifier = Modifier.semantics { contentDescription = modelLabel }
            )
            Spacer(Modifier.weight(1f))
            if (onAttach != null) {
                val attachLabel = stringResource(R.string.chat_attach)
                Box(
                    modifier = Modifier
                        .size(Tokens.touchTarget)
                        .clip(RoundedCornerShape(Tokens.Radius.md))
                        .clickable(role = Role.Button, onClick = onAttach)
                        .semantics { contentDescription = attachLabel },
                    contentAlignment = Alignment.Center
                ) { AiosIcon(R.drawable.ic_attach, contentDescription = null) }
            }
        }
        if (attachments.isNotEmpty()) AttachmentRow(attachments, onRemoveAttachment)
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

/** Chip lampiran di composer: nama, status unggah atau alasan gagal, dan tombol hapus. */
@Composable
private fun AttachmentRow(attachments: List<PendingAttachment>, onRemove: (String) -> Unit) {
    val colors = AiosTheme.colors
    val groupLabel = stringResource(R.string.chat_attachments)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .semantics { contentDescription = groupLabel },
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        attachments.forEach { item ->
            val failed = item.error != null
            val tone = if (failed) colors.danger else colors.text2
            val shape = RoundedCornerShape(Tokens.Radius.md)
            val removeLabel = stringResource(R.string.chat_attach_remove, item.name)
            Row(
                modifier = Modifier
                    .background(colors.surface2, RoundedCornerShape(Tokens.Radius.md))
                    .border(Hairline, if (failed) colors.danger else colors.border, shape)
                    .padding(start = Tokens.Space.s8),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
            ) {
                AiosIcon(R.drawable.ic_attach, contentDescription = null, tint = tone)
                Text(
                    text = item.name,
                    style = AiosTheme.type.meta,
                    color = if (failed) colors.danger else colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = Tokens.Space.s48 * 3)
                )
                val status = when {
                    item.uploading -> stringResource(R.string.chat_attach_uploading)
                    item.error != null -> stringResource(item.error)
                    else -> null
                }
                if (status != null) {
                    Text(text = status, style = AiosTheme.type.meta, color = tone)
                }
                Box(
                    modifier = Modifier
                        .size(Tokens.touchTarget)
                        .clickable(role = Role.Button) { onRemove(item.id) }
                        .semantics { contentDescription = removeLabel },
                    contentAlignment = Alignment.Center
                ) { AiosIcon(R.drawable.ic_close, contentDescription = null) }
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
