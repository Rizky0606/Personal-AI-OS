package app.aios.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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

/** Pesan pengguna: blok `surface-2` rata kanan, radius 12 (token md Android). */
@Composable
fun UserMessageRow(item: ChatItem.User, onEdit: () -> Unit, onResend: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        UserBubble(text = item.message.text)
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

@Composable
private fun UserBubble(text: String, dimmed: Boolean = false) {
    val colors = AiosTheme.colors
    Text(
        text = text,
        style = AiosTheme.type.chat,
        color = if (dimmed) colors.text2 else colors.text,
        modifier = Modifier
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
    onCopied: () -> Unit
) {
    val colors = AiosTheme.colors
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        if (item.role != null || item.model != null) {
            Row(
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
                        overflow = TextOverflow.Ellipsis
                    )
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
