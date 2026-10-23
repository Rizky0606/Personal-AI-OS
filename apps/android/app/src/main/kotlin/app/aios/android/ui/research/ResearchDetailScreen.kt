package app.aios.android.ui.research

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.ResearchJob
import app.aios.android.data.research.ExportFormat
import app.aios.android.ui.chat.markdown.MarkdownText
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.OfflineBanner
import app.aios.android.ui.components.SkeletonList
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Satu layar untuk satu job: progres live selama berjalan, laporan setelah selesai. */
@Composable
fun ResearchDetailScreen(
    online: Boolean,
    snackbar: SnackbarHostState,
    onOpenChat: (String) -> Unit,
    onNewResearch: () -> Unit,
    viewModel: ResearchDetailViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is ResearchEvent.Notice -> snackbar.showSnackbar(context.getString(event.message))
                is ResearchEvent.ExportReady -> shareExport(
                    context,
                    event.file,
                    context.getString(R.string.research_share_chooser)
                )
                is ResearchEvent.OpenChat -> onOpenChat(event.conversationId)
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        if (!online) OfflineBanner()
        val job = ui.job
        when {
            ui.loading -> SkeletonList()
            job == null -> ErrorBanner(
                message = stringResource(R.string.research_detail_error),
                onRetry = viewModel::retry,
                modifier = Modifier.padding(Tokens.Space.s16)
            )
            job.running -> ProgressView(ui, job, viewModel)
            job.status == "completed" -> ReportView(ui, job, viewModel)
            else -> EndedView(ui, job, onNewResearch)
        }
    }
}

@Composable
private fun Header(job: ResearchJob) {
    val colors = AiosTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        Text(job.question, style = AiosTheme.type.section, color = colors.text)
        Row(
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AiosChip(statusLabel(job.status), selected = job.running)
            AiosChip(stringResource(R.string.research_depth_chip, depthLabel(job.depth)))
        }
    }
}

/** Tahap berjalan, rencana sub-pertanyaan begitu tersedia, dan sumber yang masuk secara live. */
@Composable
private fun ProgressView(ui: ResearchDetailUi, job: ResearchJob, viewModel: ResearchDetailViewModel) {
    val colors = AiosTheme.colors
    val uriHandler = LocalUriHandler.current
    val liveStage = ui.live.stage
    val currentIndex = RESEARCH_STAGES.indexOf(liveStage)

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tokens.Space.s16),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s20)
    ) {
        Header(job)

        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
            Text(
                stringResource(
                    if (liveStage == null) R.string.research_stage_waiting else stageRes(liveStage)
                ),
                style = AiosTheme.type.uiStrong,
                color = colors.accent
            )
            ProgressBar(fraction = overallFraction(currentIndex, ui.live.progress))
            ui.live.message?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = AiosTheme.type.meta, color = colors.text2)
            }
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
                RESEARCH_STAGES.forEachIndexed { index, stage ->
                    StageRow(stageRes(stage), done = index < currentIndex, current = index == currentIndex)
                }
            }
            Text(
                stringResource(R.string.research_progress_closed_hint),
                style = AiosTheme.type.meta,
                color = colors.text3
            )
        }

        SectionTitle(R.string.research_plan_title)
        val plan = job.plan?.subQuestions.orEmpty()
        if (plan.isEmpty()) {
            Text(stringResource(R.string.research_plan_pending), style = AiosTheme.type.ui, color = colors.text2)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                plan.forEachIndexed { i, q -> Text("${i + 1}. $q", style = AiosTheme.type.ui, color = colors.text) }
            }
        }

        SectionTitle(R.string.research_sources_live, ui.live.sources.size)
        if (ui.live.sources.isEmpty()) {
            Text(stringResource(R.string.research_sources_none), style = AiosTheme.type.ui, color = colors.text2)
        } else {
            Column {
                ui.live.sources.forEach { s ->
                    AiosListItem(
                        title = s.title.ifBlank { s.url },
                        supporting = hostOf(s.url),
                        onClick = { uriHandler.openUri(s.url) }
                    )
                }
            }
        }

        AiosButton(
            text = stringResource(if (ui.cancelling) R.string.research_cancelling else R.string.research_cancel),
            onClick = viewModel::cancel,
            kind = ButtonKind.Danger,
            enabled = !ui.cancelling,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun SectionTitle(res: Int, count: Int? = null) {
    Text(
        text = if (count == null) stringResource(res) else stringResource(res, count),
        style = AiosTheme.type.section,
        color = AiosTheme.colors.text
    )
}

@Composable
private fun StageRow(labelRes: Int, done: Boolean, current: Boolean) {
    val colors = AiosTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8), verticalAlignment = Alignment.CenterVertically) {
        if (done) {
            AiosIcon(R.drawable.ic_check, contentDescription = null, tint = colors.success)
        } else {
            Box(
                Modifier
                    .padding(Tokens.Space.s8)
                    .size(Tokens.Space.s8)
                    .clip(RoundedCornerShape(Tokens.Radius.full))
                    .background(if (current) colors.accent else colors.border)
            )
        }
        Text(
            stringResource(labelRes),
            style = AiosTheme.type.ui,
            color = if (done || current) colors.text else colors.text3
        )
    }
}

/** Batang tipis; posisi = tahap ke-i ditambah kemajuan dalam tahap (0..1), dibagi empat tahap. */
@Composable
private fun ProgressBar(fraction: Float) {
    val colors = AiosTheme.colors
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(Tokens.Space.s4)
            .clip(RoundedCornerShape(Tokens.Radius.full))
            .background(colors.surface2)
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .height(Tokens.Space.s4)
                .background(colors.accent)
        )
    }
}

/** Laporan: Markdown dengan [n] yang bisa diketuk, daftar sumber di bawah, aksi bagikan dan lanjutkan. */
@Composable
private fun ReportView(ui: ResearchDetailUi, job: ResearchJob, viewModel: ResearchDetailViewModel) {
    val colors = AiosTheme.colors
    val uriHandler = LocalUriHandler.current
    val report = ui.report
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tokens.Space.s16),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s20)
    ) {
        Header(job)

        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
            AiosButton(
                text = stringResource(
                    if (ui.continuing) R.string.research_continuing else R.string.research_continue_chat
                ),
                onClick = viewModel::continueInChat,
                kind = ButtonKind.Primary,
                enabled = !ui.continuing,
                modifier = Modifier.fillMaxWidth()
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                ShareButton(R.string.research_share_md, ExportFormat.Markdown, ui, viewModel, Modifier.weight(1f))
                ShareButton(R.string.research_share_pdf, ExportFormat.Pdf, ui, viewModel, Modifier.weight(1f))
            }
        }

        if (report == null) {
            Text(stringResource(R.string.research_report_empty), style = AiosTheme.type.ui, color = colors.text2)
        } else {
            MarkdownText(report.bodyMd, citations = report.citations)
            if (report.sources.isNotEmpty()) {
                SectionTitle(R.string.research_sources_title)
                Column {
                    report.sources.forEach { s ->
                        AiosListItem(
                            title = "[${s.n}] ${s.title}",
                            supporting = s.meta.ifBlank { hostOf(s.url) },
                            onClick = { uriHandler.openUri(s.url) },
                            trailingContent = {
                                AiosIcon(
                                    R.drawable.ic_external_link,
                                    contentDescription = stringResource(R.string.research_source_open, hostOf(s.url))
                                )
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ShareButton(
    label: Int,
    format: ExportFormat,
    ui: ResearchDetailUi,
    viewModel: ResearchDetailViewModel,
    modifier: Modifier
) {
    val busy = ui.exporting != null
    AiosButton(
        text = stringResource(if (ui.exporting == format) R.string.research_exporting else label),
        onClick = { viewModel.export(format) },
        kind = ButtonKind.Secondary,
        enabled = !busy,
        modifier = modifier,
        leadingIcon = { AiosIcon(R.drawable.ic_share, contentDescription = null, tint = AiosTheme.colors.text) }
    )
}

/** Gagal atau dibatalkan: penjelasan dan jalan keluar. */
@Composable
private fun EndedView(ui: ResearchDetailUi, job: ResearchJob, onNewResearch: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Tokens.Space.s16),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
    ) {
        Header(job)
        if (job.status == "failed") {
            ErrorBanner(message = ui.failure ?: stringResource(R.string.research_failed_generic))
        } else {
            Text(
                stringResource(R.string.research_cancelled_note),
                style = AiosTheme.type.ui,
                color = AiosTheme.colors.text2
            )
        }
        AiosButton(
            text = stringResource(R.string.research_retry_new),
            onClick = onNewResearch,
            kind = ButtonKind.Secondary,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

private fun stageRes(stage: String): Int = when (stage) {
    "planning" -> R.string.research_stage_planning
    "searching" -> R.string.research_stage_searching
    "reading" -> R.string.research_stage_reading
    else -> R.string.research_stage_writing
}

/** Kemajuan keseluruhan 0..1 dari indeks tahap dan kemajuan dalam tahap. */
internal fun overallFraction(stageIndex: Int, withinStage: Float): Float =
    if (stageIndex < 0) 0f else ((stageIndex + withinStage.coerceIn(0f, 1f)) / RESEARCH_STAGES.size).coerceIn(0f, 1f)

internal fun hostOf(url: String): String = url.substringAfter("://").substringBefore('/').removePrefix("www.")
