package app.aios.android.ui.chat

import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
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
import androidx.compose.foundation.border
import androidx.compose.ui.text.font.FontWeight
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import app.aios.android.data.api.MessagePart
import app.aios.android.ui.chat.markdown.MarkdownText
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.SkeletonBlock
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.accentGlow
import app.aios.android.ui.chat.activity.RunActivity
import app.aios.android.ui.chat.activity.orbDescriptionRes
import app.aios.android.ui.chat.activity.phase
import app.aios.android.ui.chat.activity.toAgentPhase
import app.aios.android.ui.components.AgentOrb
import app.aios.android.ui.components.OrbSizeCompact
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.GeistMono
import app.aios.ui.tokens.Tokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

/**
 * Pesan pengguna: gelembung `accent-soft` rata kanan tanpa garis. Tekan lama membuka menu Ubah dan Hapus
 * saat tidak ada jawaban yang berjalan.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun UserMessageRow(
    item: ChatItem.User,
    onEdit: () -> Unit,
    onResend: () -> Unit,
    onStartEdit: (String) -> Unit,
    onDelete: (String) -> Unit,
    onRemember: (String) -> Unit = {}
) {
    var menuOpen by remember { mutableStateOf(false) }
    val menuLabel = stringResource(R.string.chat_message_menu)
    val files = item.message.parts.filterIsInstance<MessagePart.File>()
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        // Tekan lama di teks maupun lampiran membuka menu; pesan berisi lampiran saja tetap bisa diubah/dihapus.
        // "Ingat" tersedia kapan saja selama pesan berisi teks; Ubah dan Hapus hanya saat tidak ada jawaban berjalan.
        val canRemember = item.message.text.isNotBlank()
        Box(
            modifier = if (item.canModify || canRemember) {
                Modifier.combinedClickable(onLongClickLabel = menuLabel, onLongClick = { menuOpen = true }) {}
            } else {
                Modifier
            }
        ) {
            Column(horizontalAlignment = Alignment.End) {
                if (item.message.text.isNotEmpty() || files.isEmpty()) {
                    UserBubble(text = item.message.text, sentAt = item.message.createdAt)
                }
                if (files.isNotEmpty()) FileChips(files)
            }
            MessageMenu(
                expanded = menuOpen,
                onDismiss = { menuOpen = false },
                onEdit = if (item.canModify) ({ onStartEdit(item.message.id) }) else null,
                onDelete = if (item.canModify) ({ onDelete(item.message.id) }) else null,
                onRemember = if (canRemember) ({ onRemember(item.message.text) }) else null
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

private const val DOT_CYCLE_MS = Tokens.Motion.LoopMinMs
private const val DOT_STEP_MS = 150
private const val DOT_LOW_ALPHA = 0.25f

/** Tiga titik yang memudar bergiliran selama jawaban masih ditulis. */
@Composable
private fun TypingDots() {
    val decorative = AiosTheme.motion.decorative
    val transition = if (decorative) rememberInfiniteTransition(label = "typing") else null
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
        repeat(3) { index ->
            // Animasi dimatikan sistem: titik diam dengan opasitas penuh.
            val alpha = transition?.animateFloat(
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
            )?.value ?: 1f
            Box(
                Modifier
                    .size(Tokens.Space.s8 * 3 / 4)
                    .alpha(alpha)
                    .accentGlow(CircleShape)
                    .background(AiosTheme.colors.accent, CircleShape)
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

/** Menu pesan: Ubah dan Ingat (hanya pesan pengguna) serta Hapus. */
@Composable
private fun MessageMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    onEdit: (() -> Unit)?,
    onDelete: (() -> Unit)?,
    onRemember: (() -> Unit)? = null
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        if (onRemember != null) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.memory_remember), style = AiosTheme.type.ui) },
                leadingIcon = { AiosIcon(R.drawable.ic_pin, contentDescription = null) },
                onClick = {
                    onDismiss()
                    onRemember()
                }
            )
        }
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
        if (onDelete != null) {
            DropdownMenuItem(
                text = {
                    Text(
                        stringResource(R.string.chat_message_delete),
                        style = AiosTheme.type.ui,
                        color = AiosTheme.colors.danger
                    )
                },
                leadingIcon = {
                    AiosIcon(R.drawable.ic_trash, contentDescription = null, tint = AiosTheme.colors.danger)
                },
                onClick = {
                    onDismiss()
                    onDelete()
                }
            )
        }
    }
}

@Composable
private fun UserBubble(text: String, dimmed: Boolean = false, sentAt: String? = null, modifier: Modifier = Modifier) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(
        topStart = Tokens.Radius.lg,
        topEnd = Tokens.Radius.sm,
        bottomEnd = Tokens.Radius.lg,
        bottomStart = Tokens.Radius.lg
    )
    Column(
        modifier = modifier
            .widthIn(max = Tokens.Space.s48 * 7)
            .background(colors.accentSoft, shape)
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s12),
        horizontalAlignment = Alignment.End
    ) {
        Text(text = text, style = AiosTheme.type.chat, color = if (dimmed) colors.text2 else colors.text)
        val time = sentAt?.let(::clockOf)
        if (time != null) {
            val sent = stringResource(R.string.chat_sent)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4),
                modifier = Modifier.padding(top = Tokens.Space.s4)
            ) {
                Text(time, style = AiosTheme.type.caption.copy(fontFamily = GeistMono), color = colors.text3)
                AiosIcon(
                    R.drawable.ic_check,
                    contentDescription = sent,
                    tint = colors.accent,
                    modifier = Modifier.size(Tokens.Space.s12)
                )
            }
        }
    }
}

/** Jam lokal (mis. 14.22) dari waktu ISO; null bila formatnya tidak dikenal. */
private fun clockOf(iso: String): String? = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH.mm"))
}.getOrNull()

/** Avatar bot dengan titik status: hijau saat selesai, cyan saat jawaban masih ditulis. */
@Composable
private fun BotAvatar(streaming: Boolean) {
    val colors = AiosTheme.colors
    val shape = CircleShape
    Box(modifier = Modifier.size(Tokens.Space.s32)) {
        Box(
            modifier = Modifier
                .size(Tokens.Space.s32)
                .accentGlow(shape, enabled = streaming)
                .background(colors.accentSoft, shape),
            contentAlignment = Alignment.Center
        ) { AiosIcon(R.drawable.ic_bot, contentDescription = null, tint = colors.accent) }
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .size(Tokens.Space.s12)
                .background(colors.bg, CircleShape)
                .padding(Tokens.Space.s4 / 2)
                .background(if (streaming) colors.accent else colors.success, CircleShape)
        )
    }
}

/** Jawaban asisten tanpa kartu: avatar kecil, nama, chip role, dan model di atas, lalu langkah tool dan teks. */
@Composable
fun AssistantMessageRow(
    item: ChatItem.Assistant,
    roleName: (String) -> String,
    onCopied: () -> Unit,
    onDelete: (String) -> Unit = {},
    onDownload: FileDownload = { _, _ -> },
) {
    val colors = AiosTheme.colors
    var menuOpen by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Tokens.Space.s4),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        run {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
                verticalAlignment = Alignment.CenterVertically
            ) {
                BotAvatar(item.streaming)
                Text(
                    text = stringResource(R.string.chat_assistant_name),
                    style = AiosTheme.type.ui.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.text
                )
                val orbPhase = when {
                    item.trace != null -> item.trace.phase().toAgentPhase()
                    item.streaming -> AgentPhase.Thinking
                    else -> AgentPhase.Done
                }
                AgentOrb(
                    phase = orbPhase,
                    size = OrbSizeCompact,
                    contentDescription = stringResource(orbPhase.orbDescriptionRes())
                )
                item.role?.let { role ->
                    AiosChip(text = roleName(role), selected = item.streaming)
                }
                item.model?.let {
                    Text(
                        text = it,
                        style = AiosTheme.type.caption.copy(fontFamily = GeistMono),
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
        // Run yang punya jejak (live atau baru selesai): baris aktivitas; pesan lama dari server: baris langkah biasa.
        if (item.trace != null) RunActivity(item.trace) else item.tools.forEach { ToolStepRow(it) }
        when {
            item.text.isNotEmpty() -> MarkdownText(item.text, onCopied = onCopied, streaming = item.streaming)
            item.streaming -> Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                SkeletonBlock(height = Tokens.Space.s12)
                SkeletonBlock(height = Tokens.Space.s12, width = Tokens.Space.s48 * 4)
            }
        }
        if (item.streaming && item.text.isNotEmpty()) TypingDots()
        item.files.forEach { file -> GeneratedFileRow(file, onDownload) }
        if (!item.streaming) CodeZipButton(item.text)
    }
}

/** Berkas yang dibuat agent untuk pemilik (folder kiriman); Unduh membuka dialog simpan sistem. */
@Composable
private fun GeneratedFileRow(file: MessagePart.File, onDownload: FileDownload) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(file.mime)) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        onDownload(file) { bytes ->
            withContext(Dispatchers.IO) {
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("stream")
            }
        }
    }
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    val label = stringResource(R.string.chat_file_download_label, file.name)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surface2, shape)
            .border(Hairline, colors.border, shape)
            .padding(start = Tokens.Space.s12),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = file.name,
            style = AiosTheme.type.ui,
            color = colors.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        AiosButton(
            text = stringResource(R.string.chat_file_download),
            onClick = { launcher.launch(file.name) },
            kind = ButtonKind.Ghost,
            modifier = Modifier.semantics { contentDescription = label },
            leadingIcon = { AiosIcon(R.drawable.ic_download, contentDescription = null) }
        )
    }
}

/** Unduh semua blok kode di jawaban sebagai satu zip lewat dialog simpan sistem; tidak tampil tanpa blok kode. */
@Composable
private fun CodeZipButton(text: String) {
    val files = remember(text) { CodeArchive.extract(text) }
    if (files.isEmpty()) return
    val context = LocalContext.current
    val saved = stringResource(R.string.chat_zip_saved)
    val failed = stringResource(R.string.chat_zip_failed)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val ok = runCatching {
            context.contentResolver.openOutputStream(uri)?.use { it.write(CodeArchive.zip(files)) } ?: error("stream")
        }.isSuccess
        Toast.makeText(context, if (ok) saved else failed, Toast.LENGTH_SHORT).show()
    }
    Box(Modifier.fillMaxWidth().height(Hairline).background(AiosTheme.colors.border))
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        AiosButton(
            text = pluralStringResource(R.plurals.chat_zip_download, files.size, files.size),
            onClick = {
                val stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmm"))
                launcher.launch("kode-$stamp.zip")
            },
            leadingIcon = { AiosIcon(R.drawable.ic_download, contentDescription = null) }
        )
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
            .clip(RoundedCornerShape(Tokens.Radius.sm))
            .background(colors.surface2)
            .clickable(role = Role.Button) { open = !open }
            .padding(horizontal = Tokens.Space.s8, vertical = Tokens.Space.s4)
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
