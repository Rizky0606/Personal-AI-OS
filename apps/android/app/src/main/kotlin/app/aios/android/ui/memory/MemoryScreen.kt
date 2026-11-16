package app.aios.android.ui.memory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.MEMORY_PROPOSAL_PENDING
import app.aios.android.data.api.MEMORY_PROPOSAL_UNDONE
import app.aios.android.data.api.MEMORY_TEXT_MAX
import app.aios.android.data.api.Memory
import app.aios.android.data.api.MemoryProposal
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.StateHost
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Memori yang terlihat (A9): fakta tentang pemilik yang dipilih per pesan untuk pesan sistem; bisa disematkan. */
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
        ui.items.isEmpty() && ui.proposals.isEmpty() -> ScreenState.Empty
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
                val pending = ui.proposals.filter { it.status == MEMORY_PROPOSAL_PENDING }
                val auto = ui.proposals.filter { it.status != MEMORY_PROPOSAL_PENDING }
                if (pending.isNotEmpty()) {
                    item(key = "proposals-header") {
                        SectionHeader(
                            stringResource(R.string.memory_proposals_title, pending.size),
                            stringResource(R.string.memory_proposals_intro)
                        )
                    }
                    items(pending, key = { "proposal-${it.id}" }) { proposal ->
                        ProposalRow(
                            proposal = proposal,
                            enabled = online && ui.deciding == null,
                            onApprove = { viewModel.approveProposal(proposal) },
                            onEdit = { viewModel.startEditProposal(proposal) },
                            onReject = { viewModel.rejectProposal(proposal) }
                        )
                    }
                }
                if (auto.isNotEmpty()) {
                    item(key = "auto-header") {
                        SectionHeader(
                            stringResource(R.string.memory_auto_title, auto.size),
                            stringResource(R.string.memory_auto_intro)
                        )
                    }
                    items(auto, key = { "auto-${it.id}" }) { proposal ->
                        AutoSavedRow(
                            proposal = proposal,
                            enabled = online && ui.deciding == null,
                            onUndo = { viewModel.undoProposal(proposal) }
                        )
                    }
                }
                items(ui.items, key = { it.id }) { memory ->
                    MemoryRow(
                        memory = memory,
                        enabled = online,
                        onToggle = { viewModel.setEnabled(memory, it) },
                        onPin = { viewModel.setPinned(memory, it) },
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
    ui.proposalEditing?.let {
        EditProposalDialog(
            text = ui.proposalText,
            saving = ui.deciding != null,
            onText = viewModel::onProposalText,
            onSave = viewModel::approveEditedProposal,
            onDismiss = viewModel::cancelEditProposal
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
private fun SectionHeader(title: String, intro: String) {
    val colors = AiosTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
    ) {
        Text(title, style = AiosTheme.type.section, color = colors.text)
        Text(intro, style = AiosTheme.type.meta, color = colors.text2)
    }
}

private fun Modifier.proposalRow(border: Color) = this
    .fillMaxWidth()
    .drawBehind {
        val y = size.height - Hairline.toPx() / 2
        val inset = Tokens.Space.s16.toPx()
        drawLine(border, Offset(inset, y), Offset(size.width - inset, y), Hairline.toPx())
    }
    .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s12)

/** Satu usulan memori: fakta, kutipan pesan pemilik, dan aksi Simpan, Ubah lalu simpan, atau Tolak. */
@Composable
private fun ProposalRow(
    proposal: MemoryProposal,
    enabled: Boolean,
    onApprove: () -> Unit,
    onEdit: () -> Unit,
    onReject: () -> Unit
) {
    val colors = AiosTheme.colors
    Column(
        modifier = Modifier.proposalRow(colors.border),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
    ) {
        Text(proposal.text, style = AiosTheme.type.ui, color = colors.text)
        if (proposal.kind == "update" && proposal.targetText != null) {
            Text(
                stringResource(R.string.memory_proposal_replaces, proposal.targetText),
                style = AiosTheme.type.meta,
                color = colors.text2
            )
        }
        Text(
            stringResource(R.string.memory_proposal_evidence, proposal.evidence),
            style = AiosTheme.type.meta,
            color = colors.text3
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
        ) {
            AiosButton(
                stringResource(R.string.memory_proposal_approve),
                onClick = onApprove,
                kind = ButtonKind.Primary,
                enabled = enabled
            )
            AiosButton(
                stringResource(R.string.memory_proposal_edit_approve),
                onClick = onEdit,
                kind = ButtonKind.Secondary,
                enabled = enabled
            )
            AiosButton(
                stringResource(R.string.memory_proposal_reject),
                onClick = onReject,
                kind = ButtonKind.Ghost,
                enabled = enabled
            )
        }
    }
}

/** Memori yang disimpan otomatis (mode auto): Urungkan; yang sudah diurungkan dicoret tanpa aksi. */
@Composable
private fun AutoSavedRow(proposal: MemoryProposal, enabled: Boolean, onUndo: () -> Unit) {
    val colors = AiosTheme.colors
    val undone = proposal.status == MEMORY_PROPOSAL_UNDONE
    Column(
        modifier = Modifier.proposalRow(colors.border),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
    ) {
        Text(
            proposal.text,
            style = AiosTheme.type.ui,
            color = if (undone) colors.text3 else colors.text,
            textDecoration = if (undone) TextDecoration.LineThrough else null
        )
        if (proposal.kind == "update" && proposal.previousText != null) {
            Text(
                stringResource(R.string.memory_proposal_replaces, proposal.previousText),
                style = AiosTheme.type.meta,
                color = colors.text2
            )
        }
        Text(
            stringResource(R.string.memory_proposal_evidence, proposal.evidence),
            style = AiosTheme.type.meta,
            color = colors.text3
        )
        if (undone) {
            Text(
                stringResource(R.string.memory_proposal_undone_badge),
                style = AiosTheme.type.meta,
                color = colors.text2
            )
        } else {
            AiosButton(
                stringResource(R.string.memory_proposal_undo),
                onClick = onUndo,
                kind = ButtonKind.Secondary,
                enabled = enabled
            )
        }
    }
}

/** "Ubah lalu simpan": batas sama dengan desktop (dirapikan, tidak kosong, maks MEMORY_TEXT_MAX karakter). */
@Composable
private fun EditProposalDialog(
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
                stringResource(R.string.memory_proposal_edit_title),
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
                stringResource(if (saving) R.string.memory_saving else R.string.memory_proposal_approve),
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

@Composable
private fun MemoryRow(
    memory: Memory,
    enabled: Boolean,
    onToggle: (Boolean) -> Unit,
    onPin: (Boolean) -> Unit,
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
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
                Text(
                    text = memory.text,
                    style = AiosTheme.type.ui.copy(
                        textDecoration = if (memory.enabled) null else TextDecoration.LineThrough
                    ),
                    color = if (memory.enabled) colors.text else colors.text3
                )
                if (memory.pinned) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4)
                    ) {
                        AiosIcon(
                            R.drawable.ic_pin,
                            contentDescription = null,
                            modifier = Modifier.size(PIN_BADGE_ICON)
                        )
                        Text(
                            stringResource(R.string.memory_pinned_badge),
                            style = AiosTheme.type.meta,
                            color = colors.text2
                        )
                    }
                }
            }
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
                stringResource(if (memory.pinned) R.string.memory_unpin else R.string.memory_pin),
                onClick = { onPin(!memory.pinned) },
                kind = ButtonKind.Ghost,
                enabled = enabled
            )
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
private val PIN_BADGE_ICON = 12.dp

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
