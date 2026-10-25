package app.aios.android.ui.chat

import androidx.activity.compose.rememberLauncherForActivityResult
import app.aios.android.ui.memory.RememberDialog
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.realtime.ConnectionState
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.OfflineBanner
import app.aios.android.ui.components.SkeletonBlock
import app.aios.android.ui.components.SkeletonList
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

private const val PREFETCH_DISTANCE = 4

/** Jenis yang diterima gateway: gambar, PDF, DOCX, dan teks. */
private val ATTACH_MIME_TYPES = arrayOf(
    "image/*",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/*",
    "application/json"
)

/** Layar chat: daftar pesan (jangkar di bawah), indikator sambungan, dan composer. */
@Composable
fun ChatScreen(viewModel: ChatViewModel, snackbar: SnackbarHostState) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val connection by viewModel.connection.collectAsStateWithLifecycle()
    val online by viewModel.online.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val copiedText = stringResource(R.string.chat_copied)
    var modelSheet by remember { mutableStateOf(false) }
    var roleSheet by remember { mutableStateOf(false) }
    var toDelete by remember { mutableStateOf<String?>(null) }
    var toRemember by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) viewModel.addAttachments(uris.map { it.toString() })
    }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            if (event is ChatEvent.Notice) snackbar.showSnackbar(context.getString(event.message))
        }
    }

    val items = remember(ui.messages, ui.pending, ui.live, ui.runError, ui.sending) { buildChatItems(ui).asReversed() }
    val listState = rememberLazyListState()

    // Pesan baru atau jawaban yang mulai mengalir: ikut ke bawah bila pengguna sedang di dasar.
    LaunchedEffect(items.size, ui.pending) {
        if (listState.firstVisibleItemIndex <= 1 || ui.pending != null) listState.scrollToItem(0)
    }
    LaunchedEffect(listState, ui.conversationId) {
        snapshotFlow {
            val info = listState.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - PREFETCH_DISTANCE
        }.distinctUntilChanged().filter { it }.collect { viewModel.loadOlder() }
    }

    val scope = rememberCoroutineScope()
    val voice = rememberVoiceInput(
        currentDraft = { ui.draft },
        onDraft = viewModel::onDraft,
        onError = { error ->
            scope.launch { snackbar.showSnackbar(context.getString(voiceErrorMessage(error))) }
        }
    )

    // Dipanggil sebagai asisten digital (A12): langsung mendengarkan suara.
    LaunchedEffect(ui.voiceRequested) {
        if (ui.voiceRequested) {
            viewModel.consumeVoiceRequest()
            voice.start()
        }
    }

    val selectedModelLabel = ui.selectedModel?.let { id -> ui.models.firstOrNull { it.id == id }?.label ?: id }
    val modelLabel = selectedModelLabel ?: stringResource(R.string.chat_model_auto)
    val roleNames = remember(ui.roles) { ui.roles.associate { it.id to it.name } }

    Column(modifier = Modifier.fillMaxSize().imePadding()) {
        if (!online) OfflineBanner()
        if (online && connection is ConnectionState.Reconnecting) ReconnectingStrip()
        ui.newInSpace?.let { SpaceStrip(it.name) }

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when {
                ui.loading && items.isEmpty() -> SkeletonList()
                ui.loadError != null && items.isEmpty() -> ErrorBanner(
                    message = stringResource(R.string.chat_load_error),
                    onRetry = viewModel::retryLoad,
                    modifier = Modifier.padding(Tokens.Space.s16)
                )
                items.isEmpty() -> ChatWelcome(onPick = viewModel::onDraft)
                else -> MessageList(
                    items = items,
                    loadingOlder = ui.loadingOlder,
                    listState = listState,
                    roleName = { roleNames[it] ?: it },
                    onEdit = viewModel::editLast,
                    onResend = viewModel::resendLast,
                    onStartEdit = viewModel::startEdit,
                    onDelete = { toDelete = it },
                    onRemember = { toRemember = it },
                    onRoleClick = { roleSheet = true },
                    onCopied = { /* umpan balik lewat snackbar di bawah */ },
                    copiedText = copiedText,
                    snackbar = snackbar
                )
            }
        }

        if (ui.editingId != null) EditingStrip(onCancel = viewModel::cancelEdit)

        Composer(
            draft = ui.draft,
            onDraft = viewModel::onDraft,
            streaming = ui.streaming,
            sending = ui.sending,
            modelLabel = modelLabel,
            onSend = viewModel::send,
            onStop = viewModel::stop,
            onPickModel = { modelSheet = true },
            voice = voice,
            attachments = ui.attachments,
            onAttach = { picker.launch(ATTACH_MIME_TYPES) },
            onRemoveAttachment = viewModel::removeAttachment
        )
    }

    if (modelSheet) {
        ModelSheet(
            models = ui.models,
            selected = ui.selectedModel,
            onSelect = {
                viewModel.selectModel(it)
                modelSheet = false
            },
            onDismiss = { modelSheet = false }
        )
    }
    toDelete?.let { target ->
        DeleteMessageDialog(
            onConfirm = {
                viewModel.deleteMessage(target)
                toDelete = null
            },
            onDismiss = { toDelete = null }
        )
    }
    toRemember?.let { text ->
        RememberDialog(initial = text, snackbar = snackbar, onDismiss = { toRemember = null })
    }
    if (roleSheet) {
        RoleSheet(
            roles = ui.roles,
            current = ui.lastAssistantMessage?.agentRole,
            onSelect = {
                viewModel.reroute(it)
                roleSheet = false
            },
            onDismiss = { roleSheet = false }
        )
    }
}

@Composable
private fun MessageList(
    items: List<ChatItem>,
    loadingOlder: Boolean,
    listState: androidx.compose.foundation.lazy.LazyListState,
    roleName: (String) -> String,
    onEdit: () -> Unit,
    onResend: () -> Unit,
    onStartEdit: (String) -> Unit,
    onDelete: (String) -> Unit,
    onRemember: (String) -> Unit,
    onRoleClick: () -> Unit,
    onCopied: () -> Unit,
    copiedText: String,
    snackbar: SnackbarHostState
) {
    var copiedTick by remember { mutableStateOf(0) }
    LaunchedEffect(copiedTick) {
        if (copiedTick > 0) snackbar.showSnackbar(copiedText)
    }
    LazyColumn(
        state = listState,
        reverseLayout = true,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(Tokens.Space.s16),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
    ) {
        items(items, key = { it.key }) { item ->
            // Pesan baru memudar masuk dan pesan lain bergeser halus (bukan melompat) saat daftar berubah.
            Box(
                Modifier.animateItem(
                    fadeInSpec = tween(Tokens.Motion.EmphasisMs, easing = Tokens.Motion.Easing),
                    placementSpec = tween(Tokens.Motion.EmphasisMs, easing = Tokens.Motion.Spring),
                    fadeOutSpec = tween(Tokens.Motion.FastMs, easing = Tokens.Motion.Easing)
                )
            ) {
                ChatRow(
                    item = item,
                    roleName = roleName,
                    onEdit = onEdit,
                    onResend = onResend,
                    onStartEdit = onStartEdit,
                    onDelete = onDelete,
                    onRemember = onRemember,
                    onRoleClick = onRoleClick,
                    onCopied = {
                        copiedTick++
                        onCopied()
                    }
                )
            }
        }
        if (loadingOlder) {
            item(key = "older") {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.Space.s8),
                    verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
                ) {
                    SkeletonBlock(height = Tokens.Space.s12)
                    SkeletonBlock(height = Tokens.Space.s12, width = Tokens.Space.s48 * 4)
                }
            }
        }
    }
}

@Suppress("LongParameterList") // Meneruskan aksi baris pesan dari daftar ke komponen tiap jenis pesan.
@Composable
private fun ChatRow(
    item: ChatItem,
    roleName: (String) -> String,
    onEdit: () -> Unit,
    onResend: () -> Unit,
    onStartEdit: (String) -> Unit,
    onDelete: (String) -> Unit,
    onRemember: (String) -> Unit,
    onRoleClick: () -> Unit,
    onCopied: () -> Unit
) {
    when (item) {
        is ChatItem.User -> UserMessageRow(
            item,
            onEdit = onEdit,
            onResend = onResend,
            onStartEdit = onStartEdit,
            onDelete = onDelete,
            onRemember = onRemember
        )
        is ChatItem.PendingUser -> PendingUserRow(item)
        is ChatItem.Assistant -> AssistantMessageRow(
            item = item,
            roleName = roleName,
            onRoleClick = onRoleClick,
            onCopied = onCopied,
            onDelete = onDelete
        )
        is ChatItem.System -> SystemNoteRow(item.message.text)
        is ChatItem.Failure -> FailureRow(item, onResend = onResend)
    }
}

/** Baris di atas composer selama pesan sedang diubah. */
@Composable
private fun EditingStrip(onCancel: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        Text(
            text = stringResource(R.string.chat_editing_banner),
            style = AiosTheme.type.caption,
            color = AiosTheme.colors.text2,
            modifier = Modifier.weight(1f)
        )
        AiosButton(stringResource(R.string.chat_editing_cancel), onCancel, kind = ButtonKind.Ghost)
    }
}

@Composable
private fun DeleteMessageDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val colors = AiosTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        title = {
            Text(
                stringResource(R.string.chat_message_delete_title),
                style = AiosTheme.type.section,
                color = colors.text
            )
        },
        text = {
            Text(
                stringResource(R.string.chat_message_delete_body),
                style = AiosTheme.type.ui,
                color = colors.text2
            )
        },
        confirmButton = {
            AiosButton(stringResource(R.string.chat_message_delete), onClick = onConfirm, kind = ButtonKind.Danger)
        },
        dismissButton = {
            AiosButton(stringResource(R.string.chat_delete_cancel), onClick = onDismiss, kind = ButtonKind.Ghost)
        }
    )
}

/** Penanda chat ruang pengetahuan (A13): jawaban memakai dokumen ruang ini sebagai sumber. */
@Composable
private fun SpaceStrip(name: String) {
    Text(
        text = stringResource(R.string.space_chat_strip, name),
        style = AiosTheme.type.caption,
        color = AiosTheme.colors.info,
        modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s4)
    )
}

/** Indikator kecil saat soket menyambung ulang: satu baris teks, tanpa dialog. */
@Composable
private fun ReconnectingStrip() {
    val colors = AiosTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s4),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = stringResource(R.string.chat_reconnecting),
            style = AiosTheme.type.caption,
            color = colors.text2
        )
    }
}

private fun voiceErrorMessage(error: VoiceError): Int = when (error) {
    VoiceError.NotAvailable -> R.string.chat_voice_unavailable
    VoiceError.NoSpeech -> R.string.chat_voice_no_speech
    VoiceError.PermissionDenied -> R.string.chat_voice_permission
    VoiceError.Failed -> R.string.chat_voice_failed
}
