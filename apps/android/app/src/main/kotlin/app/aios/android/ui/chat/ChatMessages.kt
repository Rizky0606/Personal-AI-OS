package app.aios.android.ui.chat

import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import app.aios.android.R
import app.aios.android.data.api.MessagePart
import app.aios.android.ui.chat.markdown.MarkdownText
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.SkeletonBlock
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.PlexMono
import app.aios.ui.tokens.Tokens
import java.util.Locale

/**
 * Pesan pengguna: blok `surface-2` rata kanan, radius 12 (token md Android). Tekan lama membuka menu Ubah dan
 * Hapus saat tidak ada jawaban yang berjalan.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun UserMessageRow(
    item: ChatItem.User,
    onEdit: () -> Unit,
    onResend: () -> Unit,
    onStartEdit: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var menuOpen by remember { mutableStateOf(false) }
    val menuLabel = stringResource(R.string.chat_message_menu)
    val files = item.message.parts.filterIsInstance<MessagePart.File>()
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        // Tekan lama di teks maupun lampiran membuka menu; pesan berisi lampiran saja tetap bisa diubah/dihapus.
        Box(
            modifier = if (item.canModify) {
                Modifier.combinedClickable(onLongClickLabel = menuLabel, onLongClick = { menuOpen = true }) {}
            } else {
                Modifier
            }
        ) {
            Column(horizontalAlignment = Alignment.End) {
                if (item.message.text.isNotEmpty() || files.isEmpty()) UserBubble(text = item.message.text)
                if (files.isNotEmpty()) FileChips(files)
            }
            MessageMenu(
                expanded = menuOpen,
                onDismiss = { menuOpen = false },
                onEdit = { onStartEdit(item.message.id) },
                onDelete = { onDelete(item.message.id) }
            )
        }
        if (item.canEdit) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
                AiosButton(stringResource(R.string.chat_edit_last), onEdit, kind = ButtonKind.Ghost)
                AiosButton(stringResource(R.string.chat_resend_last), onResend, kind = ButtonKind.Ghost)
            }
        }
    }
}

@Composable
fun PendingUserRow(item: ChatItem.PendingUser) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        UserBubble(text = item.text, dimmed = true)
    }
}

private const val DOT_CYCLE_MS = 1200
private const val DOT_STEP_MS = 150
private const val DOT_LOW_ALPHA = 0.25f

/** Tiga titik yang memudar bergiliran selama jawaban masih ditulis. */
@Composable
private fun TypingDots() {
    val transition = rememberInfiniteTransition(label = "typing")
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(
                initialValue = DOT_LOW_ALPHA,
                targetValue = DOT_LOW_ALPHA,
                animationSpec = infiniteRepeatable(
                    keyframes {
                        durationMillis = DOT_CYCLE_MS
                        DOT_LOW_ALPHA at 0
                        1f at DOT_CYCLE_MS / 3
                        DOT_LOW_ALPHA at DOT_CYCLE_MS * 2 / 3
                    },
                    initialStartOffset = StartOffset(index * DOT_STEP_MS)
                ),
                label = "dot$index"
            )
            Box(
                Modifier
                    .size(Tokens.Space.s8 * 3 / 4)
                    .alpha(alpha)
                    .background(AiosTheme.colors.text3, CircleShape)
            )
        }
    }
}

/** Lampiran pesan pengguna: chip nama berkas di bawah teks. */
@Composable
private fun FileChips(files: List<MessagePart.File>) {
    val colors = AiosTheme.colors
    val label = stringResource(R.string.chat_attachments)
    Column(
        modifier = Modifier.padding(top = Tokens.Space.s4).semantics { contentDescription = label },
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
    ) {
        files.forEach { file ->
            Row(
                modifier = Modifier
                    .background(colors.surface2, RoundedCornerShape(Tokens.Radius.md))
                    .padding(horizontal = Tokens.Space.s8, vertical = Tokens.Space.s4),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
            ) {
                AiosIcon(R.drawable.ic_attach, contentDescription = null, tint = colors.text2)
                Text(
                    text = file.name,
                    style = AiosTheme.type.meta,
                    color = colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = Tokens.Space.s48 * 5)
                )
            }
        }
    }
}

/** Menu pesan: Ubah (hanya pesan pengguna) dan Hapus. */
@Composable
private fun MessageMenu(expanded: Boolean, onDismiss: () -> Unit, onEdit: (() -> Unit)?, onDelete: () -> Unit) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        if (onEdit != null) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.chat_message_edit), style = AiosTheme.type.ui) },
                leadingIcon = { AiosIcon(R.drawable.ic_pencil, contentDescription = null) },
                onClick = {
                    onDismiss()
                    onEdit()
                }
            )
        }
        DropdownMenuItem(
            text = {
                Text(
                    stringResource(R.string.chat_message_delete),
                    style = AiosTheme.type.ui,
                    color = AiosTheme.colors.danger
                )
            },
            leadingIcon = { AiosIcon(R.drawable.ic_trash, contentDescription = null, tint = AiosTheme.colors.danger) },
            onClick = {
                onDismiss()
                onDelete()
            }
        )
    }
}

@Composable
private fun UserBubble(text: String, dimmed: Boolean = false, modifier: Modifier = Modifier) {
    val colors = AiosTheme.colors
    Text(
        text = text,
        style = AiosTheme.type.chat,
        color = if (dimmed) colors.text2 else colors.text,
        modifier = modifier
            .widthIn(max = Tokens.Space.s48 * 7)
            .background(colors.surface2, RoundedCornerShape(Tokens.Radius.md))
            .padding(horizontal = Tokens.Space.s12, vertical = Tokens.Space.s8)
    )
}

/** Jawaban asisten: tanpa gelembung; chip role dan model di atas, langkah tool, lalu teks Markdown. */
@Composable
fun AssistantMessageRow(
    item: ChatItem.Assistant,
    roleName: (String) -> String,
    onRoleClick: () -> Unit,
    onCopied: () -> Unit,
    onDelete: (String) -> Unit = {}
) {
    val colors = AiosTheme.colors
    var menuOpen by remember { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        if (item.role != null || item.model != null || item.canModify) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
                verticalAlignment = Alignment.CenterVertically
            ) {
                item.role?.let { role ->
                    val name = roleName(role)
                    val description = stringResource(R.string.chat_role_label, name)
                    AiosChip(
                        text = name,
                        selected = item.streaming,
                        onClick = if (item.canReroute) onRoleClick else null,
                        modifier = Modifier.semantics { if (item.canReroute) contentDescription = description }
                    )
                }
                item.model?.let {
                    Text(
                        text = it,
                        style = AiosTheme.type.caption.copy(fontFamily = PlexMono),
                        color = colors.text3,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                }
                if (item.canModify) {
                    Spacer(Modifier.weight(1f))
                    Box {
                        Box(
                            modifier = Modifier
                                .size(Tokens.touchTarget)
                                .clickable(role = Role.Button) { menuOpen = true },
                            contentAlignment = Alignment.Center
                        ) {
                            AiosIcon(
                                R.drawable.ic_more,
                                contentDescription = stringResource(R.string.chat_message_menu)
                            )
                        }
                        MessageMenu(
                            expanded = menuOpen,
                            onDismiss = { menuOpen = false },
                            onEdit = null,
                            onDelete = { onDelete(item.id) }
                        )
                    }
                }
            }
        }
        if (item.reasoning.isNotBlank()) ReasoningBlock(item.id, item.reasoning)
        item.tools.forEach { ToolStepRow(it) }
        when {
            item.text.isNotEmpty() -> MarkdownText(item.text, onCopied = onCopied)
            item.streaming -> Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                SkeletonBlock(height = Tokens.Space.s12)
                SkeletonBlock(height = Tokens.Space.s12, width = Tokens.Space.s48 * 4)
            }
        }
        if (item.streaming && item.text.isNotEmpty()) TypingDots()
    }
}

@Composable
private fun ReasoningBlock(id: String, text: String) {
    var open by rememberSaveable(id, "reasoning") { mutableStateOf(false) }
    val colors = AiosTheme.colors
    Column {
        Row(
            modifier = Modifier
                .clickable(role = Role.Button) { open = !open }
                .padding(vertical = Tokens.Space.s8),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
        ) {
            AiosIcon(if (open) R.drawable.ic_chevron_down else R.drawable.ic_chevron_right, contentDescription = null)
            Text(stringResource(R.string.chat_reasoning), style = AiosTheme.type.meta, color = colors.text2)
        }
        if (open) Text(text, style = AiosTheme.type.meta, color = colors.text2)
    }
}

/** Satu baris mono yang bisa dibuka: ikon, nama tool, target, status, durasi. */
@Composable
fun ToolStepRow(step: ToolStep) {
    var open by rememberSaveable(step.id) { mutableStateOf(false) }
    val colors = AiosTheme.colors
    val statusColor = when (step.status) {
        "running" -> colors.accent
        "ok" -> colors.success
        "error", "denied" -> colors.danger
        else -> colors.text3
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button) { open = !open }
            .padding(vertical = Tokens.Space.s4)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AiosIcon(R.drawable.ic_terminal, contentDescription = null, tint = colors.text2)
            Text(text = step.name, style = AiosTheme.type.mono, color = colors.text)
            Text(
                text = step.target.orEmpty(),
                style = AiosTheme.type.mono,
                color = colors.text2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            Text(text = statusLabel(step), style = AiosTheme.type.mono, color = statusColor)
        }
        if (open && !step.target.isNullOrEmpty()) {
            Text(
                text = step.target,
                style = AiosTheme.type.mono,
                color = colors.text,
                modifier = Modifier.padding(start = Tokens.Space.s32, top = Tokens.Space.s4)
            )
        }
    }
}

@Composable
private fun statusLabel(step: ToolStep): String {
    val label = stringResource(
        when (step.status) {
            "running" -> R.string.chat_tool_running
            "ok" -> R.string.chat_tool_ok
            "error" -> R.string.chat_tool_error
            "denied" -> R.string.chat_tool_denied
            else -> R.string.chat_tool_cancelled
        }
    )
    val ms = step.durationMs ?: return label
    return String.format(Locale.US, "%s %.1fs", label, ms / MS_PER_SECOND)
}

private const val MS_PER_SECOND = 1000.0

@Composable
fun SystemNoteRow(text: String) {
    Text(
        text = text,
        style = AiosTheme.type.meta,
        color = AiosTheme.colors.text2,
        modifier = Modifier.fillMaxWidth()
    )
}

@Composable
fun FailureRow(item: ChatItem.Failure, onResend: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        ErrorBanner(message = item.message.ifBlank { stringResource(R.string.chat_run_failed) })
        AiosButton(stringResource(R.string.chat_resend_last), onResend, kind = ButtonKind.Secondary)
    }
}
