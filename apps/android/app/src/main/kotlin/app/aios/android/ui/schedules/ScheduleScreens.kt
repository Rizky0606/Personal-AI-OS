package app.aios.android.ui.schedules

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.Schedule
import app.aios.android.data.api.ScheduleRun
import app.aios.android.data.api.TARGET_CHAT
import app.aios.android.data.api.TARGET_RESEARCH
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.OfflineBanner
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.SkeletonList
import app.aios.android.ui.components.StateHost
import app.aios.android.ui.research.RelativeTime
import app.aios.android.ui.research.relativeLabel
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/* ---------- Daftar ---------- */

@Composable
fun ScheduleListScreen(
    online: Boolean,
    snackbar: SnackbarHostState,
    onNew: () -> Unit,
    onOpen: (Schedule) -> Unit,
    viewModel: ScheduleListViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect {
            if (it is ScheduleEvent.Notice) snackbar.showSnackbar(context.getString(it.message))
        }
    }
    val state = when {
        ui.loading -> ScreenState.Loading
        ui.error != null -> ScreenState.Error(stringResource(R.string.schedule_list_error))
        ui.items.isEmpty() -> ScreenState.Empty
        else -> ScreenState.Content
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16)) {
            AiosButton(
                text = stringResource(R.string.schedule_new),
                onClick = onNew,
                kind = ButtonKind.Primary,
                modifier = Modifier.fillMaxWidth()
            )
        }
        StateHost(
            state = state,
            offline = !online,
            emptyMessage = stringResource(R.string.schedule_list_empty),
            onRetry = { viewModel.refresh() }
        ) {
            LazyColumn {
                items(ui.items, key = { it.id }) { schedule ->
                    ScheduleRow(
                        schedule = schedule,
                        lastRun = ui.lastRuns[schedule.id],
                        onClick = { onOpen(schedule) },
                        onToggle = { viewModel.setEnabled(schedule, it) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ScheduleRow(schedule: Schedule, lastRun: ScheduleRun?, onClick: () -> Unit, onToggle: (Boolean) -> Unit) {
    val next = ScheduleFormat.instant(schedule.nextRunAt, schedule.timezone)
    val nextText = when {
        !schedule.enabled -> stringResource(R.string.schedule_off)
        next != null -> stringResource(R.string.schedule_next, next)
        else -> stringResource(R.string.schedule_next_none)
    }
    val resultText = lastRun?.let {
        stringResource(
            R.string.schedule_last,
            runStatusLabel(it.status),
            relativeLabel(RelativeTime.of(it.startedAt, System.currentTimeMillis()))
        )
    } ?: stringResource(R.string.schedule_never_run)
    val switchLabel = stringResource(R.string.schedule_toggle, schedule.name)
    AiosListItem(
        title = schedule.name,
        supporting = "$nextText\n$resultText",
        onClick = onClick,
        trailingContent = {
            Switch(
                checked = schedule.enabled,
                onCheckedChange = onToggle,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = AiosTheme.colors.accent,
                    checkedThumbColor = AiosTheme.onAccent,
                    uncheckedTrackColor = AiosTheme.colors.surface2,
                    uncheckedThumbColor = AiosTheme.colors.text3,
                    uncheckedBorderColor = AiosTheme.colors.borderStrong
                ),
                modifier = Modifier.semantics { contentDescription = switchLabel }
            )
        }
    )
}

@Composable
fun runStatusLabel(status: String): String = stringResource(
    when (status) {
        "succeeded" -> R.string.schedule_run_succeeded
        "failed" -> R.string.schedule_run_failed
        "missed" -> R.string.schedule_run_missed
        else -> R.string.schedule_run_running
    }
)

/* ---------- Buat ---------- */

@Composable
fun ScheduleCreateScreen(
    online: Boolean,
    onCreated: (String) -> Unit,
    viewModel: ScheduleCreateViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) {
        viewModel.events.collect { if (it is ScheduleEvent.Created) onCreated(it.id) }
    }
    val colors = AiosTheme.colors
    Column(
        modifier = Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())
    ) {
        if (!online) OfflineBanner()
        Column(
            modifier = Modifier.padding(Tokens.Space.s16),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
        ) {
            ui.formError?.let { ErrorBanner(message = ui.serverMessage ?: stringResource(it)) }
            val draft = ui.draft
            if (draft == null) {
                AiosTextField(
                    value = ui.text,
                    onValueChange = viewModel::onText,
                    label = stringResource(R.string.schedule_text_label),
                    placeholder = stringResource(R.string.schedule_text_hint),
                    supportingText = stringResource(R.string.schedule_text_support),
                    errorText = ui.textError?.let { stringResource(it) },
                    enabled = !ui.parsing,
                    singleLine = false
                )
                AiosButton(
                    text = stringResource(if (ui.parsing) R.string.schedule_parsing else R.string.schedule_parse),
                    onClick = viewModel::parse,
                    kind = ButtonKind.Primary,
                    enabled = !ui.parsing,
                    modifier = Modifier.fillMaxWidth()
                )
            } else {
                Text(
                    stringResource(R.string.schedule_preview_title),
                    style = AiosTheme.type.section,
                    color = colors.text
                )
                Text(draft.description, style = AiosTheme.type.chat, color = colors.accent)
                Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
                    Text(
                        stringResource(R.string.schedule_next_three),
                        style = AiosTheme.type.meta,
                        color = colors.text2
                    )
                    draft.nextRuns.forEach { iso ->
                        Text(
                            ScheduleFormat.instant(iso, draft.timezone) ?: iso,
                            style = AiosTheme.type.mono,
                            color = colors.text
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                    AiosChip(targetLabel(draft.target))
                    draft.agentRole?.let { AiosChip(it) }
                }
                AiosTextField(
                    value = ui.name,
                    onValueChange = viewModel::onName,
                    label = stringResource(R.string.schedule_name_label)
                )
                AiosTextField(
                    value = ui.prompt,
                    onValueChange = viewModel::onPrompt,
                    label = stringResource(R.string.schedule_prompt_label),
                    singleLine = false
                )
                AiosButton(
                    text = stringResource(if (ui.saving) R.string.schedule_saving else R.string.schedule_save),
                    onClick = viewModel::save,
                    kind = ButtonKind.Primary,
                    enabled = !ui.saving,
                    modifier = Modifier.fillMaxWidth()
                )
                AiosButton(
                    text = stringResource(R.string.schedule_edit_text),
                    onClick = viewModel::editText,
                    kind = ButtonKind.Ghost,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
private fun targetLabel(target: String): String = stringResource(
    when (target) {
        TARGET_RESEARCH -> R.string.schedule_target_research
        TARGET_CHAT -> R.string.schedule_target_chat
        else -> R.string.schedule_target_role
    }
)

/* ---------- Detail ---------- */

@Composable
fun ScheduleDetailScreen(
    online: Boolean,
    snackbar: SnackbarHostState,
    onOpenConversation: (String) -> Unit,
    onClosed: () -> Unit,
    viewModel: ScheduleDetailViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is ScheduleEvent.Notice -> snackbar.showSnackbar(context.getString(event.message))
                ScheduleEvent.RunStarted -> snackbar.showSnackbar(context.getString(R.string.schedule_run_started))
                ScheduleEvent.Deleted -> onClosed()
                is ScheduleEvent.Created -> Unit
            }
        }
    }
    val schedule = ui.schedule
    Column(modifier = Modifier.fillMaxSize()) {
        if (!online) OfflineBanner()
        when {
            ui.loading -> SkeletonList()
            schedule == null -> ErrorBanner(
                message = stringResource(R.string.schedule_list_error),
                onRetry = { viewModel.load() },
                modifier = Modifier.padding(Tokens.Space.s16)
            )
            else -> DetailBody(ui, schedule, viewModel, onOpenConversation) { confirmDelete = true }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            containerColor = AiosTheme.colors.surface,
            title = {
                Text(
                    stringResource(R.string.schedule_delete_title),
                    style = AiosTheme.type.section,
                    color = AiosTheme.colors.text
                )
            },
            text = {
                Text(
                    stringResource(R.string.schedule_delete_body),
                    style = AiosTheme.type.ui,
                    color = AiosTheme.colors.text2
                )
            },
            confirmButton = {
                AiosButton(
                    stringResource(R.string.chat_delete_confirm),
                    onClick = {
                        confirmDelete = false
                        viewModel.delete()
                    },
                    kind = ButtonKind.Danger
                )
            },
            dismissButton = {
                AiosButton(
                    stringResource(R.string.chat_delete_cancel),
                    onClick = { confirmDelete = false },
                    kind = ButtonKind.Ghost
                )
            }
        )
    }
}

@Composable
private fun DetailBody(
    ui: ScheduleDetailUi,
    schedule: Schedule,
    viewModel: ScheduleDetailViewModel,
    onOpenConversation: (String) -> Unit,
    onDelete: () -> Unit
) {
    val colors = AiosTheme.colors
    val next = ScheduleFormat.instant(schedule.nextRunAt, schedule.timezone)
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tokens.Space.s16),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(schedule.name, style = AiosTheme.type.section, color = colors.text)
                Text(schedule.cron, style = AiosTheme.type.mono, color = colors.text2)
                Text(
                    text = when {
                        !schedule.enabled -> stringResource(R.string.schedule_off)
                        next != null -> stringResource(R.string.schedule_next, next)
                        else -> stringResource(R.string.schedule_next_none)
                    },
                    style = AiosTheme.type.meta,
                    color = colors.text2
                )
            }
            Switch(
                checked = schedule.enabled,
                onCheckedChange = viewModel::setEnabled,
                modifier = Modifier.semantics { contentDescription = schedule.name }
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
            AiosButton(
                text = stringResource(if (ui.runningNow) R.string.schedule_running_now else R.string.schedule_run_now),
                onClick = viewModel::runNow,
                kind = ButtonKind.Primary,
                enabled = !ui.runningNow,
                modifier = Modifier.weight(1f)
            )
            schedule.conversationId?.let { conversation ->
                AiosButton(
                    text = stringResource(R.string.schedule_open_results),
                    onClick = { onOpenConversation(conversation) },
                    kind = ButtonKind.Secondary,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        AiosTextField(
            value = ui.editName,
            onValueChange = viewModel::onName,
            label = stringResource(R.string.schedule_name_label)
        )
        AiosTextField(
            value = ui.editPrompt,
            onValueChange = viewModel::onPrompt,
            label = stringResource(R.string.schedule_prompt_label),
            singleLine = false
        )
        AiosButton(
            text = stringResource(if (ui.saving) R.string.schedule_saving else R.string.schedule_save_changes),
            onClick = viewModel::saveEdits,
            kind = ButtonKind.Secondary,
            enabled = !ui.saving,
            modifier = Modifier.fillMaxWidth()
        )

        Text(stringResource(R.string.schedule_history_title), style = AiosTheme.type.section, color = colors.text)
        if (ui.runs.isEmpty()) {
            Text(stringResource(R.string.schedule_history_empty), style = AiosTheme.type.ui, color = colors.text2)
        } else {
            Column {
                ui.runs.forEach { run ->
                    AiosListItem(
                        title = runStatusLabel(run.status),
                        supporting = ScheduleFormat.instant(run.startedAt, schedule.timezone) ?: run.startedAt
                    )
                }
                if (ui.nextBefore != null) {
                    AiosButton(
                        text = stringResource(R.string.schedule_history_more),
                        onClick = viewModel::loadMoreRuns,
                        kind = ButtonKind.Ghost,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }

        AiosButton(
            text = stringResource(R.string.schedule_delete),
            onClick = onDelete,
            kind = ButtonKind.Danger,
            modifier = Modifier.fillMaxWidth()
        )
    }
}
