package app.aios.android.ui.proposals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.AGENT_HERMES
import app.aios.android.data.api.AGENT_PROPOSAL_SCHEDULE
import app.aios.android.data.api.AgentProposal
import app.aios.android.data.api.SCHEDULE_PROPOSAL_NAME_MAX
import app.aios.android.data.api.SCHEDULE_PROPOSAL_PROMPT_MAX
import app.aios.android.data.api.TARGET_RESEARCH
import app.aios.android.data.api.TASK_PROPOSAL_BODY_MAX
import app.aios.android.data.api.TASK_PROPOSAL_TITLE_MAX
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.StateHost
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

private const val BODY_MAX_LINES = 4

/** Usulan agent: kartu dan jadwal yang menunggu keputusan pemilik. Isi usulan teks biasa, bukan markdown. */
@Composable
fun AgentProposalsScreen(
    online: Boolean,
    snackbar: SnackbarHostState,
    viewModel: AgentProposalViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect {
            if (it is AgentProposalEvent.Notice) snackbar.showSnackbar(context.getString(it.message))
        }
    }
    val state = when {
        ui.loading -> ScreenState.Loading
        ui.error != null -> ScreenState.Error(stringResource(ui.error!!.messageRes))
        ui.items.isEmpty() -> ScreenState.Empty
        else -> ScreenState.Content
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            stringResource(R.string.agent_proposals_intro),
            style = AiosTheme.type.meta,
            color = AiosTheme.colors.text2,
            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16)
        )
        StateHost(
            state = state,
            offline = !online,
            emptyMessage = stringResource(R.string.agent_proposals_empty),
            onRetry = { viewModel.refresh() }
        ) {
            LazyColumn {
                items(ui.items, key = { it.id }) { proposal ->
                    ProposalRow(
                        proposal = proposal,
                        enabled = online && ui.deciding == null,
                        onApprove = { viewModel.approve(proposal) },
                        onEdit = { viewModel.startEdit(proposal) },
                        onReject = { viewModel.reject(proposal) }
                    )
                }
            }
        }
    }
    val editing = ui.editing
    if (editing != null) {
        EditProposalDialog(
            proposal = editing,
            draft = ui.edit,
            saving = ui.saving,
            viewModel = viewModel
        )
    }
}

/** Satu usulan: jenis dan agent, judul, isi dipotong, alasan agent, peringatan web, lalu Setujui/Ubah/Tolak. */
@Composable
private fun ProposalRow(
    proposal: AgentProposal,
    enabled: Boolean,
    onApprove: () -> Unit,
    onEdit: () -> Unit,
    onReject: () -> Unit
) {
    val colors = AiosTheme.colors
    val task = proposal.task
    val schedule = proposal.schedule
    val title = task?.title ?: schedule?.name.orEmpty()
    val body = task?.body ?: schedule?.prompt.orEmpty()
    val kind = stringResource(
        if (schedule != null) R.string.agent_proposal_kind_schedule else R.string.agent_proposal_kind_task
    )
    val agent = stringResource(
        if (proposal.agent == AGENT_HERMES) R.string.agent_proposal_agent_hermes else R.string.agent_proposal_agent_omp
    )
    val approveLabel = if (schedule != null) {
        stringResource(R.string.agent_proposal_approve_schedule_label, title)
    } else {
        stringResource(R.string.agent_proposal_approve_task_label, title)
    }
    val rejectLabel = stringResource(R.string.agent_proposal_reject_label, title)
    val editLabel = stringResource(R.string.agent_proposal_edit_label, title)
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
        Text("$kind · $agent", style = AiosTheme.type.meta, color = colors.text3, maxLines = 1)
        Text(title, style = AiosTheme.type.ui, color = colors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (schedule != null) {
            val target = if (schedule.target == TARGET_RESEARCH) {
                stringResource(R.string.schedule_target_research)
            } else {
                stringResource(R.string.schedule_target_chat)
            }
            Text(
                stringResource(R.string.agent_proposal_schedule_meta, proposal.description ?: schedule.cron, target),
                style = AiosTheme.type.meta,
                color = colors.text2
            )
        }
        if (body.isNotBlank()) {
            Text(
                body,
                style = AiosTheme.type.meta,
                color = colors.text2,
                maxLines = BODY_MAX_LINES,
                overflow = TextOverflow.Ellipsis
            )
        }
        if (proposal.reason.isNotBlank()) {
            Text(
                stringResource(R.string.agent_proposal_reason, proposal.reason),
                style = AiosTheme.type.meta,
                color = colors.text3
            )
        }
        if (proposal.afterWeb) AfterWebWarning()
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
        ) {
            AiosButton(
                stringResource(R.string.agent_proposal_approve),
                onClick = onApprove,
                kind = ButtonKind.Primary,
                enabled = enabled,
                modifier = Modifier.semantics { contentDescription = approveLabel }
            )
            AiosButton(
                stringResource(R.string.agent_proposal_edit_approve),
                onClick = onEdit,
                kind = ButtonKind.Secondary,
                enabled = enabled,
                modifier = Modifier.semantics { contentDescription = editLabel }
            )
            AiosButton(
                stringResource(R.string.agent_proposal_reject),
                onClick = onReject,
                kind = ButtonKind.Ghost,
                enabled = enabled,
                modifier = Modifier.semantics { contentDescription = rejectLabel }
            )
        }
    }
}

/** Peringatan dalam teks dan ikon (bukan warna saja): isi usulan bisa berasal dari halaman web. */
@Composable
private fun AfterWebWarning() {
    val colors = AiosTheme.colors
    Row(
        modifier = Modifier.padding(vertical = Tokens.Space.s4),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        AiosIcon(
            R.drawable.ic_alert,
            contentDescription = stringResource(R.string.agent_proposal_after_web_label),
            tint = colors.warning
        )
        Text(
            stringResource(R.string.agent_proposal_after_web),
            style = AiosTheme.type.meta,
            color = colors.text,
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * "Ubah lalu setujui": isian usulan bisa diperbaiki pemilik sebelum kartu atau jadwal dibuat. Batasnya sama dengan
 * kontrak; kolom wajib yang kosong membuat tombol simpan mati.
 */
@Composable
private fun EditProposalDialog(
    proposal: AgentProposal,
    draft: AgentProposalEditDraft,
    saving: Boolean,
    viewModel: AgentProposalViewModel
) {
    val colors = AiosTheme.colors
    val schedule = proposal.kind == AGENT_PROPOSAL_SCHEDULE
    AlertDialog(
        onDismissRequest = { viewModel.cancelEdit() },
        containerColor = colors.surface,
        title = {
            Text(
                stringResource(
                    if (schedule) {
                        R.string.agent_proposal_edit_schedule_title
                    } else {
                        R.string.agent_proposal_edit_task_title
                    }
                ),
                style = AiosTheme.type.section,
                color = colors.text
            )
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()).imePadding(),
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.s12)
            ) {
                if (schedule) {
                    ScheduleEditFields(draft, saving, viewModel)
                } else {
                    TaskEditFields(draft, saving, viewModel)
                }
            }
        },
        confirmButton = {
            AiosButton(
                stringResource(if (saving) R.string.agent_proposal_saving else R.string.agent_proposal_save),
                onClick = { viewModel.approveEdited() },
                kind = ButtonKind.Primary,
                enabled = !saving && draft.isComplete(proposal.kind)
            )
        },
        dismissButton = {
            AiosButton(
                stringResource(R.string.agent_proposal_cancel),
                onClick = { viewModel.cancelEdit() },
                kind = ButtonKind.Ghost,
                enabled = !saving
            )
        }
    )
}

/** Isian usulan kartu: judul wajib, deskripsi boleh kosong. */
@Composable
private fun TaskEditFields(draft: AgentProposalEditDraft, saving: Boolean, viewModel: AgentProposalViewModel) {
    AiosTextField(
        value = draft.title,
        onValueChange = { viewModel.onTitleChange(it) },
        label = stringResource(R.string.agent_proposal_title_label),
        supportingText = stringResource(
            R.string.agent_proposal_counter,
            draft.title.trim().length,
            TASK_PROPOSAL_TITLE_MAX
        ),
        enabled = !saving
    )
    AiosTextField(
        value = draft.body,
        onValueChange = { viewModel.onBodyChange(it) },
        label = stringResource(R.string.agent_proposal_body_label),
        supportingText = stringResource(
            R.string.agent_proposal_counter,
            draft.body.trim().length,
            TASK_PROPOSAL_BODY_MAX
        ),
        enabled = !saving,
        singleLine = false,
        maxLines = 6
    )
}

/** Isian usulan jadwal: nama, cron, zona waktu, dan instruksi wajib; sakelar menentukan aktif setelah disetujui. */
@Composable
private fun ScheduleEditFields(draft: AgentProposalEditDraft, saving: Boolean, viewModel: AgentProposalViewModel) {
    val colors = AiosTheme.colors
    val enableLabel = stringResource(R.string.agent_proposal_enable)
    AiosTextField(
        value = draft.name,
        onValueChange = { viewModel.onNameChange(it) },
        label = stringResource(R.string.agent_proposal_name_label),
        supportingText = stringResource(
            R.string.agent_proposal_counter,
            draft.name.trim().length,
            SCHEDULE_PROPOSAL_NAME_MAX
        ),
        enabled = !saving
    )
    AiosTextField(
        value = draft.cron,
        onValueChange = { viewModel.onCronChange(it) },
        label = stringResource(R.string.agent_proposal_cron_label),
        placeholder = stringResource(R.string.agent_proposal_cron_placeholder),
        enabled = !saving
    )
    AiosTextField(
        value = draft.timezone,
        onValueChange = { viewModel.onTimezoneChange(it) },
        label = stringResource(R.string.agent_proposal_timezone_label),
        placeholder = stringResource(R.string.agent_proposal_timezone_placeholder),
        enabled = !saving
    )
    AiosTextField(
        value = draft.prompt,
        onValueChange = { viewModel.onPromptChange(it) },
        label = stringResource(R.string.agent_proposal_prompt_label),
        supportingText = stringResource(
            R.string.agent_proposal_counter,
            draft.prompt.trim().length,
            SCHEDULE_PROPOSAL_PROMPT_MAX
        ),
        enabled = !saving,
        singleLine = false,
        maxLines = 6
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        Text(enableLabel, style = AiosTheme.type.ui, color = colors.text, modifier = Modifier.weight(1f))
        Switch(
            checked = draft.enabled,
            onCheckedChange = { viewModel.onEnabledChange(it) },
            enabled = !saving,
            colors = SwitchDefaults.colors(
                checkedTrackColor = colors.accent,
                checkedThumbColor = AiosTheme.onAccent,
                uncheckedTrackColor = colors.surface2,
                uncheckedThumbColor = colors.text3,
                uncheckedBorderColor = colors.borderStrong
            ),
            modifier = Modifier.semantics { contentDescription = enableLabel }
        )
    }
}
