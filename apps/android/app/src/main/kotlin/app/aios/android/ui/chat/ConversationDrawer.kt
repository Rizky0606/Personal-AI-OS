package app.aios.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import app.aios.android.R
import app.aios.android.data.api.Conversation
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.StateHost
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Daftar percakapan di drawer kiri: cari, filter arsip, sematkan, arsipkan, hapus. */
@Composable
fun ConversationDrawer(
    ui: ConversationsUiState,
    selectedId: String?,
    online: Boolean,
    onQuery: (String) -> Unit,
    onArchivedMode: (Boolean) -> Unit,
    onSelect: (Conversation) -> Unit,
    onNew: () -> Unit,
    onRetry: () -> Unit,
    onTogglePinned: (Conversation) -> Unit,
    onSetArchived: (Conversation, Boolean) -> Unit,
    onDelete: (Conversation) -> Unit
) {
    val colors = AiosTheme.colors
    var toDelete by remember { mutableStateOf<Conversation?>(null) }

    ModalDrawerSheet(drawerContainerColor = colors.surface, drawerContentColor = colors.text) {
        Column(modifier = Modifier.fillMaxHeight().statusBarsPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(
                    start = Tokens.Space.s16,
                    end = Tokens.Space.s16,
                    top = Tokens.Space.s12
                ),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(R.string.chat_drawer_title),
                    style = AiosTheme.type.section,
                    color = colors.text,
                    modifier = Modifier.weight(1f)
                )
            }
            Column(
                modifier = Modifier.padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s12),
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.s12)
            ) {
                AiosButton(
                    text = stringResource(R.string.chat_new),
                    onClick = onNew,
                    kind = ButtonKind.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                    leadingIcon = { AiosIcon(R.drawable.ic_plus, contentDescription = null, tint = colors.text) }
                )
                AiosTextField(
                    value = ui.query,
                    onValueChange = onQuery,
                    label = stringResource(R.string.chat_search_label),
                    placeholder = stringResource(R.string.chat_search_hint)
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                    AiosChip(
                        stringResource(R.string.chat_filter_active),
                        selected = !ui.archived,
                        onClick = { onArchivedMode(false) }
                    )
                    AiosChip(
                        stringResource(R.string.chat_filter_archived),
                        selected = ui.archived,
                        onClick = { onArchivedMode(true) }
                    )
                }
            }

            val state = when {
                ui.loading -> ScreenState.Loading
                ui.error != null -> ScreenState.Error(stringResource(ui.error.messageRes))
                ui.items.isEmpty() -> ScreenState.Empty
                else -> ScreenState.Content
            }
            val emptyRes = when {
                ui.query.isNotBlank() -> R.string.chat_conversations_empty_search
                ui.archived -> R.string.chat_conversations_empty_archived
                else -> R.string.chat_conversations_empty
            }
            StateHost(
                state = state,
                offline = !online,
                emptyMessage = stringResource(emptyRes),
                onRetry = onRetry
            ) {
                LazyColumn {
                    items(ui.items, key = { it.id }) { conversation ->
                        ConversationRow(
                            conversation = conversation,
                            selected = conversation.id == selectedId,
                            onSelect = { onSelect(conversation) },
                            onTogglePinned = { onTogglePinned(conversation) },
                            onSetArchived = { onSetArchived(conversation, it) },
                            onDelete = { toDelete = conversation }
                        )
                    }
                }
            }
        }
    }

    toDelete?.let { target ->
        AlertDialog(
            onDismissRequest = { toDelete = null },
            containerColor = colors.surface,
            title = {
                Text(
                    stringResource(R.string.chat_delete_title),
                    style = AiosTheme.type.section,
                    color = colors.text
                )
            },
            text = { Text(stringResource(R.string.chat_delete_body), style = AiosTheme.type.ui, color = colors.text2) },
            confirmButton = {
                AiosButton(
                    stringResource(R.string.chat_delete_confirm),
                    onClick = {
                        onDelete(target)
                        toDelete = null
                    },
                    kind = ButtonKind.Danger
                )
            },
            dismissButton = {
                AiosButton(
                    stringResource(R.string.chat_delete_cancel),
                    onClick = { toDelete = null },
                    kind = ButtonKind.Ghost
                )
            }
        )
    }
}

@Composable
private fun ConversationRow(
    conversation: Conversation,
    selected: Boolean,
    onSelect: () -> Unit,
    onTogglePinned: () -> Unit,
    onSetArchived: (Boolean) -> Unit,
    onDelete: () -> Unit
) {
    var menuOpen by remember { mutableStateOf(false) }
    val archived = conversation.archivedAt != null
    val title = conversation.title.ifBlank { stringResource(R.string.chat_untitled) }
    val menuLabel = stringResource(R.string.chat_conversation_menu)

    AiosListItem(
        title = title,
        supporting = if (conversation.pinned) stringResource(R.string.chat_pinned_marker) else null,
        leadingIcon = if (conversation.pinned) R.drawable.ic_pin else null,
        selected = selected,
        onClick = onSelect,
        trailingContent = {
            Box {
                Box(
                    modifier = Modifier
                        .size(Tokens.touchTarget)
                        .clickable(role = Role.Button) { menuOpen = true },
                    contentAlignment = Alignment.Center
                ) { AiosIcon(R.drawable.ic_more, contentDescription = menuLabel) }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = {
                            Text(
                                stringResource(if (conversation.pinned) R.string.chat_unpin else R.string.chat_pin),
                                style = AiosTheme.type.ui
                            )
                        },
                        leadingIcon = { AiosIcon(R.drawable.ic_pin, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            onTogglePinned()
                        }
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                stringResource(if (archived) R.string.chat_unarchive else R.string.chat_archive),
                                style = AiosTheme.type.ui
                            )
                        },
                        leadingIcon = { AiosIcon(R.drawable.ic_archive, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            onSetArchived(!archived)
                        }
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                stringResource(R.string.chat_delete),
                                style = AiosTheme.type.ui,
                                color = AiosTheme.colors.danger
                            )
                        },
                        leadingIcon = {
                            AiosIcon(
                                R.drawable.ic_trash,
                                contentDescription = null,
                                tint = AiosTheme.colors.danger
                            )
                        },
                        onClick = {
                            menuOpen = false
                            onDelete()
                        }
                    )
                }
            }
        }
    )
}
