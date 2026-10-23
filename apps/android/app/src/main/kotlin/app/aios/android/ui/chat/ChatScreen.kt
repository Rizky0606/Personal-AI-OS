package app.aios.android.ui.chat

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
import app.aios.android.ui.components.EmptyState
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.OfflineBanner
import app.aios.android.ui.components.SkeletonBlock
import app.aios.android.ui.components.SkeletonList
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

private const val PREFETCH_DISTANCE = 4

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

    val selectedModelLabel = ui.selectedModel?.let { id -> ui.models.firstOrNull { it.id == id }?.label ?: id }
    val modelLabel = selectedModelLabel ?: stringResource(R.string.chat_model_auto)
    val roleNames = remember(ui.roles) { ui.roles.associate { it.id to it.name } }

    Column(modifier = Modifier.fillMaxSize().imePadding()) {
        if (!online) OfflineBanner()
        if (online && connection is ConnectionState.Reconnecting) ReconnectingStrip()

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when {
                ui.loading && items.isEmpty() -> SkeletonList()
                ui.loadError != null && items.isEmpty() -> ErrorBanner(
                    message = stringResource(R.string.chat_load_error),
                    onRetry = viewModel::retryLoad,
                    modifier = Modifier.padding(Tokens.Space.s16)
                )
                items.isEmpty() -> EmptyState(stringResource(R.string.chat_empty_new))
                else -> MessageList(
                    items = items,
                    loadingOlder = ui.loadingOlder,
                    listState = listState,
                    roleName = { roleNames[it] ?: it },
                    onEdit = viewModel::editLast,
                    onResend = viewModel::resendLast,
                    onRoleClick = { roleSheet = true },
                    onCopied = { /* umpan balik lewat snackbar di bawah */ },
                    copiedText = copiedText,
                    snackbar = snackbar
                )
            }
        }

        Composer(
            draft = ui.draft,
            onDraft = viewModel::onDraft,
            streaming = ui.streaming,
            sending = ui.sending,
            modelLabel = modelLabel,
            onSend = viewModel::send,
            onStop = viewModel::stop,
            onPickModel = { modelSheet = true },
            voice = voice
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
            when (item) {
                is ChatItem.User -> UserMessageRow(item, onEdit = onEdit, onResend = onResend)
                is ChatItem.PendingUser -> PendingUserRow(item)
                is ChatItem.Assistant -> AssistantMessageRow(
                    item = item,
                    roleName = roleName,
                    onRoleClick = onRoleClick,
                    onCopied = {
                        copiedTick++
                        onCopied()
                    }
                )
                is ChatItem.System -> SystemNoteRow(item.message.text)
                is ChatItem.Failure -> FailureRow(item, onResend = onResend)
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
