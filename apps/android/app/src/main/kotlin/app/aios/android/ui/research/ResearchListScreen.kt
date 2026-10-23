package app.aios.android.ui.research

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.ResearchJob
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.SkeletonBlock
import app.aios.android.ui.components.StateHost
import app.aios.ui.tokens.Tokens
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

private const val PREFETCH_DISTANCE = 3

/** Tab Riset: tombol riset baru di atas, lalu daftar job (status, waktu, jumlah sumber). */
@Composable
fun ResearchListScreen(
    online: Boolean,
    onNew: () -> Unit,
    onOpen: (ResearchJob) -> Unit,
    viewModel: ResearchListViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val state = when {
        ui.loading -> ScreenState.Loading
        ui.error != null -> ScreenState.Error(stringResource(R.string.research_list_error))
        ui.items.isEmpty() -> ScreenState.Empty
        else -> ScreenState.Content
    }
    val listState = rememberLazyListState()
    LaunchedEffect(listState) {
        snapshotFlow {
            val info = listState.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - PREFETCH_DISTANCE
        }.distinctUntilChanged().filter { it }.collect { viewModel.loadMore() }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16)) {
            AiosButton(
                text = stringResource(R.string.research_new),
                onClick = onNew,
                kind = ButtonKind.Primary,
                modifier = Modifier.fillMaxWidth()
            )
        }
        StateHost(
            state = state,
            offline = !online,
            emptyMessage = stringResource(R.string.research_list_empty),
            onRetry = { viewModel.refresh() }
        ) {
            LazyColumn(state = listState) {
                items(ui.items, key = { it.id }) { job -> JobRow(job, onClick = { onOpen(job) }) }
                if (ui.loadingMore) {
                    item(key = "more") {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16),
                            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
                        ) { SkeletonBlock(height = Tokens.Space.s12) }
                    }
                }
            }
        }
    }
}

@Composable
private fun JobRow(job: ResearchJob, onClick: () -> Unit) {
    val sources = job.reportMd?.let { ReportParser.parse(it).sources.size } ?: 0
    val status = statusLabel(job.status)
    val time = relativeLabel(RelativeTime.of(job.createdAt, System.currentTimeMillis()))
    val summary = buildString {
        append(status)
        if (sources > 0) append(" · ").append(stringResource(R.string.research_sources_count, sources))
        append(" · ").append(time)
    }
    AiosListItem(title = job.question, supporting = summary, onClick = onClick)
}

@Composable
fun statusLabel(status: String): String = stringResource(
    when (status) {
        "queued" -> R.string.research_status_queued
        "running" -> R.string.research_status_running
        "completed" -> R.string.research_status_completed
        "failed" -> R.string.research_status_failed
        else -> R.string.research_status_cancelled
    }
)

@Composable
fun relativeLabel(time: RelativeTime): String = when (time) {
    RelativeTime.JustNow -> stringResource(R.string.research_time_just_now)
    is RelativeTime.Minutes -> stringResource(R.string.research_time_minutes, time.n.toInt())
    is RelativeTime.Hours -> stringResource(R.string.research_time_hours, time.n.toInt())
    is RelativeTime.Date -> time.text
}
