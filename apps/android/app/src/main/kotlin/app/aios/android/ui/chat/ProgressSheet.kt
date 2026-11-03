package app.aios.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import app.aios.android.R
import app.aios.android.data.api.ProgressOutput
import app.aios.android.ui.chat.activity.ProgressStep
import app.aios.android.ui.chat.activity.ProgressView
import app.aios.android.ui.chat.activity.StepState
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

private const val VISIBLE_STEPS = 3

/** Ikon status per langkah (fase token sudah dipakai [StatusDot] di RunActivity, di sini teks saja cukup). */
private fun stepGlyph(state: StepState): String = when (state) {
    StepState.Done -> "✓"
    StepState.Active -> "›"
    StepState.Blocked -> "!"
    StepState.Abandoned -> "–"
    StepState.Pending -> "·"
}

/**
 * Bottom sheet panel Progres (paritas desktop P2B, P6): Progres (linimasa, "N langkah sebelumnya"), Output
 * (kartu, ketuk membuka pratinjau), Digunakan dalam sesi ini. Satu kolom gulir (bukan tab terpisah) untuk
 * menjaga kesederhanaan; empat state (memuat belum diterapkan di sini karena data selalu sinkron dari
 * [ChatViewModel], kosong/isi ditangani per bagian, offline mewarisi banner chat).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressSheet(view: ProgressView, onDismiss: () -> Unit, onOpenOutput: (ProgressOutput) -> Unit) {
    val colors = AiosTheme.colors
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = colors.surface) {
        Column(
            modifier = Modifier.navigationBarsPadding().padding(Tokens.Space.s16),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s20)
        ) {
            Text(
                text = stringResource(R.string.progress_sheet_title),
                style = AiosTheme.type.section,
                color = colors.text
            )
            if (view.steps.isEmpty() && view.outputs.isEmpty()) {
                Text(stringResource(R.string.progress_empty), style = AiosTheme.type.ui, color = colors.text2)
            } else {
                if (view.steps.isNotEmpty()) ProgressStepsSection(view.steps)
                if (view.outputs.isNotEmpty()) OutputsSection(view.outputs, onOpenOutput)
                UsedSection(view)
            }
        }
    }
}

@Composable
private fun ProgressStepsSection(steps: List<ProgressStep>) {
    val colors = AiosTheme.colors
    var showAll by rememberSaveable { mutableStateOf(false) }
    val hidden = (steps.size - VISIBLE_STEPS).coerceAtLeast(0)
    val shown = if (showAll || hidden == 0) steps else steps.takeLast(VISIBLE_STEPS)
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        Text(stringResource(R.string.progress_tab_plan), style = AiosTheme.type.uiStrong, color = colors.text)
        if (!showAll && hidden > 0) {
            Text(
                text = stringResource(R.string.progress_previous_steps, hidden),
                style = AiosTheme.type.meta,
                color = colors.text2,
                modifier = Modifier
                    .heightIn(min = Tokens.touchTarget)
                    .clickable(role = Role.Button) { showAll = true }
            )
        }
        shown.forEach { step ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
            ) {
                Text(stepGlyph(step.state), style = AiosTheme.type.ui, color = colors.text2)
                Column {
                    step.phase?.let { Text(it, style = AiosTheme.type.meta, color = colors.text3) }
                    Text(step.label, style = AiosTheme.type.ui, color = colors.text)
                    step.blocker?.let { Text(it, style = AiosTheme.type.caption, color = colors.warning) }
                }
            }
        }
    }
}

@Composable
private fun OutputsSection(outputs: List<ProgressOutput>, onOpen: (ProgressOutput) -> Unit) {
    val colors = AiosTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        Text(stringResource(R.string.progress_tab_outputs), style = AiosTheme.type.uiStrong, color = colors.text)
        LazyColumn(modifier = Modifier.heightIn(max = 240.dp)) {
            items(outputs.size) { i ->
                val output = outputs[i]
                val label = when (output) {
                    is ProgressOutput.Image -> output.name
                    is ProgressOutput.FileOutput -> output.name
                    is ProgressOutput.Diff -> output.files.joinToString(", ") { it.path }
                    is ProgressOutput.Research -> output.title
                    is ProgressOutput.Unknown -> ""
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.touchTarget)
                        .clickable(role = Role.Button) { onOpen(output) }
                        .padding(vertical = Tokens.Space.s8),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
                ) {
                    AiosIcon(R.drawable.ic_arrow_left, contentDescription = null)
                    Text(label, style = AiosTheme.type.ui, color = colors.text)
                }
            }
        }
    }
}

@Composable
private fun UsedSection(view: ProgressView) {
    val colors = AiosTheme.colors
    val used = view.used
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
        Text(stringResource(R.string.progress_tab_used), style = AiosTheme.type.uiStrong, color = colors.text)
        if (used.engine != null || used.model != null) {
            Text(
                stringResource(R.string.progress_used_engine_model, used.engine.orEmpty(), used.model.orEmpty()),
                style = AiosTheme.type.ui,
                color = colors.text2
            )
        }
        if (used.memoryRead > 0) {
            Text(
                stringResource(R.string.progress_used_memory, used.memoryRead),
                style = AiosTheme.type.ui,
                color = colors.text2
            )
        }
        if (used.skills.isNotEmpty()) {
            Text(used.skills.joinToString(", "), style = AiosTheme.type.meta, color = colors.text3)
        }
    }
}
