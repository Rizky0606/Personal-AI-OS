package app.aios.android.ui.chat

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
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
import app.aios.android.ui.components.accentGlow
import app.aios.android.ui.components.colorGlow
import app.aios.android.ui.components.accentGradient
import app.aios.android.ui.components.focusRing
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.phase
import app.aios.ui.tokens.Tokens

private const val MAX_LINES = 6
private const val DISABLED_ALPHA = 0.5f

/**
 * Composer: kartu mengambang membulat di bawah (pemanggil memasang `imePadding`). Garis kartu menjadi aksen
 * saat kolom teks fokus. Tombol kirim bulat beraksen berubah menjadi hentikan saat jawaban mengalir.
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
    onRemoveAttachment: (String) -> Unit = {},
    /** Fase run yang berjalan; bingkai input menyala halus dengan warna fase selama [streaming]. */
    phase: AgentPhase? = null
) {
    val colors = AiosTheme.colors
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val shape = RoundedCornerShape(Tokens.Radius.lg)
    val uploading = attachments.any { it.uploading }
    val hasFiles = attachments.any { it.part != null }
    val canSend = (draft.isNotBlank() || hasFiles) && !sending && !uploading
    val composerLabel = stringResource(R.string.chat_composer_label)
    val phaseColor = if (streaming && phase != null) colors.phase(phase).fg else null
    val borderColor by animateColorAsState(
        phaseColor ?: if (focused) colors.borderStrong else colors.border,
        AiosTheme.motion.base(),
        label = "composerBorder"
    )
    val glowColor by animateColorAsState(
        phaseColor?.copy(alpha = PHASE_GLOW_ALPHA) ?: Color.Transparent,
        AiosTheme.motion.base(),
        label = "composerGlow"
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.bg)
            .padding(horizontal = Tokens.Space.s12, vertical = Tokens.Space.s8)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(Tokens.elevation, shape, clip = false)
                .background(colors.surface, shape)
                .border(if (focused) Tokens.Focus.width else Hairline, borderColor, shape)
                .padding(horizontal = Tokens.Space.s8, vertical = Tokens.Space.s4),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
        ) {
            if (attachments.isNotEmpty()) {
                Box(modifier = Modifier.padding(top = Tokens.Space.s8)) {
                    AttachmentRow(attachments, onRemoveAttachment)
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = Tokens.touchTarget)
                    .colorGlow(shape, glowColor)
                    .background(colors.surface, shape)
                    .border(Hairline, borderColor, shape)
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
            Row(
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    AiosChip(
                        text = modelLabel,
                        onClick = onPickModel,
                        modifier = Modifier.semantics { contentDescription = modelLabel }
                    )
                }
                if (onAttach != null) {
                    val attachLabel = stringResource(R.string.chat_attach)
                    Box(
                        modifier = Modifier
                            .size(Tokens.touchTarget)
                            .clip(RoundedCornerShape(Tokens.Radius.full))
                            .clickable(role = Role.Button, onClick = onAttach)
                            .semantics { contentDescription = attachLabel },
                        contentAlignment = Alignment.Center
                    ) { AiosIcon(R.drawable.ic_attach, contentDescription = null) }
                }
                MicButton(voice)
                if (streaming) {
                    ActionButton(streaming = true, canSend = canSend, onSend = onSend, onStop = onStop)
                } else {
                    ActionButton(streaming = false, canSend = canSend, onSend = onSend, onStop = onStop)
                }
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

/**
 * Tombol ikon 48dp: kirim (aksen, aksi utama layar) yang berubah menjadi hentikan (netral) saat jawaban mengalir.
 * Satu tombol yang sama: ikon bertukar dengan fade + skala dan latar aksen memudar (durasi dari MotionSpec).
 */
@Composable
private fun ActionButton(streaming: Boolean, canSend: Boolean, onSend: () -> Unit, onStop: () -> Unit) {
    val colors = AiosTheme.colors
    val motion = AiosTheme.motion
    val shape = RoundedCornerShape(Tokens.Radius.md)
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val enabled = streaming || canSend
    val alpha by animateFloatAsState(if (enabled) 1f else DISABLED_ALPHA, motion.fast(), label = "actionAlpha")
    val primary by animateFloatAsState(if (streaming) 0f else 1f, motion.fast(), label = "actionPrimary")
    val description = stringResource(if (streaming) R.string.chat_stop else R.string.chat_send)
    Box(
        modifier = Modifier
            .size(Tokens.touchTarget)
            .alpha(alpha)
            .focusRing(focused, colors.accent, Tokens.Radius.md)
            .accentGlow(shape, enabled = !streaming && canSend)
            .clip(shape)
            .background(colors.surface2)
            .clickable(
                interactionSource = source,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onClick = if (streaming) onStop else onSend
            )
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center
    ) {
        Box(Modifier.matchParentSize().alpha(primary).background(accentGradient()))
        AnimatedContent(
            targetState = streaming,
            transitionSpec = {
                val enter = fadeIn(motion.fast()) +
                    scaleIn(motion.overshoot(Tokens.Motion.FastMs), initialScale = ICON_SCALE)
                val exit = fadeOut(motion.instant()) + scaleOut(motion.fast(), targetScale = ICON_SCALE)
                enter togetherWith exit
            },
            label = "actionIcon"
        ) { stop ->
            AiosIcon(
                if (stop) R.drawable.ic_stop else R.drawable.ic_arrow_up,
                contentDescription = null,
                tint = if (stop) colors.text else AiosTheme.onAccent
            )
        }
    }
}

private const val PHASE_GLOW_ALPHA = 0.55f
private const val ICON_SCALE = 0.6f

/**
 * Tahan untuk bicara, lepas untuk berhenti. TalkBack tidak bisa menahan, jadi ada aksi klik semantik
 * yang bergantian memulai dan menghentikan.
 */
@Composable
private fun MicButton(voice: VoiceInputState) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.full)
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
