package app.aios.android.ui.memory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.MEMORY_TEXT_MAX
import app.aios.android.data.api.Memory
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.StateHost
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Memori yang terlihat (A9): fakta tentang pemilik yang ikut di setiap pesan sistem. */
@Composable
fun MemoryScreen(online: Boolean, snackbar: SnackbarHostState, viewModel: MemoryViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect { if (it is MemoryEvent.Notice) snackbar.showSnackbar(context.getString(it.message)) }
    }
    val state = when {
        ui.loading -> ScreenState.Loading
        ui.error != null -> ScreenState.Error(stringResource(ui.error!!.messageRes))
        ui.items.isEmpty() -> ScreenState.Empty
        else -> ScreenState.Content
    }
    val colors = AiosTheme.colors
    Column(modifier = Modifier.fillMaxSize().imePadding()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
        ) {
            Text(stringResource(R.string.memory_intro), style = AiosTheme.type.meta, color = colors.text2)
            AiosTextField(
                value = ui.draft,
                onValueChange = viewModel::onDraft,
                label = stringResource(R.string.memory_add_label),
                placeholder = stringResource(R.string.memory_placeholder),
                supportingText = stringResource(R.string.memory_counter, ui.draft.trim().length, MEMORY_TEXT_MAX),
                enabled = online && !ui.adding,
                singleLine = false,
                maxLines = 4
            )
            AiosButton(
                text = stringResource(if (ui.adding) R.string.memory_saving else R.string.memory_add),
                onClick = viewModel::add,
                kind = ButtonKind.Primary,
                enabled = online && !ui.adding && ui.draft.isNotBlank(),
                modifier = Modifier.fillMaxWidth()
            )
        }
        StateHost(
            state = state,
            offline = !online,
            emptyMessage = stringResource(R.string.memory_empty),
            onRetry = viewModel::refresh
        ) {
            LazyColumn {
                items(ui.items, key = { it.id }) { memory ->
                    MemoryRow(
                        memory = memory,
                        enabled = online,
                        onToggle = { viewModel.setEnabled(memory, it) },
                        onEdit = { viewModel.startEdit(memory) },
                        onDelete = { viewModel.askDelete(memory) }
                    )
                }
            }
        }
    }

    ui.editing?.let {
        EditMemoryDialog(
            text = ui.editText,
            saving = ui.saving,
            onText = viewModel::onEditText,
            onSave = viewModel::saveEdit,
            onDismiss = viewModel::cancelEdit
        )
    }
    ui.deleting?.let { memory ->
        AlertDialog(
            onDismissRequest = viewModel::cancelDelete,
            containerColor = colors.surface,
            title = {
                Text(
                    stringResource(R.string.memory_delete_title),
                    style = AiosTheme.type.section,
                    color = colors.text
                )
            },
            text = { Text(memory.text, style = AiosTheme.type.ui, color = colors.text2) },
            confirmButton = {
                AiosButton(
                    stringResource(R.string.memory_delete),
                    onClick = viewModel::confirmDelete,
                    kind = ButtonKind.Danger
                )
            },
            dismissButton = {
                AiosButton(
                    stringResource(R.string.memory_cancel),
                    onClick = viewModel::cancelDelete,
                    kind = ButtonKind.Ghost
                )
            }
        )
    }
}

@Composable
private fun MemoryRow(
    memory: Memory,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val colors = AiosTheme.colors
    val toggleLabel = stringResource(R.string.memory_toggle, memory.text.take(TOGGLE_LABEL_CHARS))
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .drawBehind {
                val y = size.height - Hairline.toPx() / 2
                val inset = Tokens.Space.s16.toPx()
                drawLine(colors.border, Offset(inset, y), Offset(size.width - inset, y), Hairline.toPx())
            }
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s12),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = memory.text,
                style = AiosTheme.type.ui.copy(
                    textDecoration = if (memory.enabled) null else TextDecoration.LineThrough
                ),
                color = if (memory.enabled) colors.text else colors.text3,
                modifier = Modifier.weight(1f)
            )
            Switch(
                checked = memory.enabled,
                onCheckedChange = onToggle,
                enabled = enabled,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = colors.accent,
                    checkedThumbColor = AiosTheme.onAccent,
                    uncheckedTrackColor = colors.surface2,
                    uncheckedThumbColor = colors.text3,
                    uncheckedBorderColor = colors.borderStrong
                ),
                modifier = Modifier.semantics { contentDescription = toggleLabel }
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
            AiosButton(
                stringResource(R.string.memory_edit),
                onClick = onEdit,
                kind = ButtonKind.Ghost,
                enabled = enabled
            )
            AiosButton(
                stringResource(R.string.memory_delete),
                onClick = onDelete,
                kind = ButtonKind.Ghost,
                enabled = enabled
            )
        }
    }
}

private const val TOGGLE_LABEL_CHARS = 60

@Composable
private fun EditMemoryDialog(
    text: String,
    saving: Boolean,
    onText: (String) -> Unit,
    onSave: () -> Unit,
    onDismiss: () -> Unit
) {
    val colors = AiosTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        title = {
            Text(
                stringResource(R.string.memory_edit_title),
                style = AiosTheme.type.section,
                color = colors.text
            )
        },
        text = {
            AiosTextField(
                value = text,
                onValueChange = onText,
                label = stringResource(R.string.memory_add_label),
                supportingText = stringResource(R.string.memory_counter, text.trim().length, MEMORY_TEXT_MAX),
                enabled = !saving,
                singleLine = false,
                maxLines = 6
            )
        },
        confirmButton = {
            AiosButton(
                stringResource(if (saving) R.string.memory_saving else R.string.memory_save),
                onClick = onSave,
                kind = ButtonKind.Primary,
                enabled = !saving && text.isNotBlank()
            )
        },
        dismissButton = {
            AiosButton(
                stringResource(R.string.memory_cancel),
                onClick = onDismiss,
                kind = ButtonKind.Ghost
            )
        }
    )
}

/** "Ingat ini" dari pesan chat: teks [initial] disunting lalu disimpan sebagai memori. */
@Composable
fun RememberDialog(
    initial: String,
    snackbar: SnackbarHostState,
    onDismiss: () -> Unit,
    viewModel: RememberViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(initial) { viewModel.start(initial) }
    LaunchedEffect(viewModel) {
        viewModel.events.collect {
            when (it) {
                is MemoryEvent.Notice -> snackbar.showSnackbar(context.getString(it.message))
                MemoryEvent.Saved -> onDismiss()
            }
        }
    }
    val colors = AiosTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        title = {
            Text(
                stringResource(R.string.memory_remember_title),
                style = AiosTheme.type.section,
                color = colors.text
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                Text(stringResource(R.string.memory_remember_body), style = AiosTheme.type.ui, color = colors.text2)
                AiosTextField(
                    value = ui.text,
                    onValueChange = viewModel::onText,
                    label = stringResource(R.string.memory_add_label),
                    supportingText = stringResource(R.string.memory_counter, ui.text.trim().length, MEMORY_TEXT_MAX),
                    enabled = !ui.saving,
                    singleLine = false,
                    maxLines = 6
                )
            }
        },
        confirmButton = {
            AiosButton(
                stringResource(if (ui.saving) R.string.memory_saving else R.string.memory_add),
                onClick = viewModel::save,
                kind = ButtonKind.Primary,
                enabled = !ui.saving && ui.text.isNotBlank()
            )
        },
        dismissButton = {
            AiosButton(
                stringResource(R.string.memory_cancel),
                onClick = onDismiss,
                kind = ButtonKind.Ghost
            )
        }
    )
}
