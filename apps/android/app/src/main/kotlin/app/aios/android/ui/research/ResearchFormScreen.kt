package app.aios.android.ui.research

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.RESEARCH_DEEP
import app.aios.android.data.api.RESEARCH_QUICK
import app.aios.android.data.api.RESEARCH_STANDARD
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Form satu layar: pertanyaan + kedalaman. Rencana sub-pertanyaan tampil di layar progres begitu tersedia. */
@Composable
fun ResearchFormScreen(onCreated: (String) -> Unit, viewModel: ResearchFormViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val colors = AiosTheme.colors
    LaunchedEffect(viewModel) { viewModel.createdJob.collect(onCreated) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(Tokens.Space.s16),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s16)
    ) {
        ui.formError?.let { ErrorBanner(message = stringResource(it)) }

        QuestionField(ui, viewModel)

        Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
            Text(stringResource(R.string.research_depth_label), style = AiosTheme.type.meta, color = colors.text2)
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                DepthChip(R.string.research_depth_quick, RESEARCH_QUICK, ui.depth, viewModel)
                DepthChip(R.string.research_depth_standard, RESEARCH_STANDARD, ui.depth, viewModel)
                DepthChip(R.string.research_depth_deep, RESEARCH_DEEP, ui.depth, viewModel)
            }
            Text(
                text = stringResource(depthDescription(ui.depth)),
                style = AiosTheme.type.meta,
                color = colors.text2
            )
        }

        Text(stringResource(R.string.research_form_note), style = AiosTheme.type.meta, color = colors.text3)

        AiosButton(
            text = stringResource(if (ui.submitting) R.string.research_starting else R.string.research_start),
            onClick = viewModel::submit,
            kind = ButtonKind.Primary,
            enabled = !ui.submitting,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun QuestionField(ui: ResearchFormUi, viewModel: ResearchFormViewModel) {
    AiosTextField(
        value = ui.question,
        onValueChange = viewModel::onQuestion,
        label = stringResource(R.string.research_question_label),
        placeholder = stringResource(R.string.research_question_hint),
        supportingText = stringResource(R.string.research_question_support),
        errorText = ui.questionError?.let { stringResource(it) },
        enabled = !ui.submitting,
        singleLine = false,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences)
    )
}

@Composable
private fun DepthChip(label: Int, value: String, current: String, viewModel: ResearchFormViewModel) {
    AiosChip(
        text = stringResource(label),
        selected = value == current,
        onClick = { viewModel.onDepth(value) }
    )
}

private fun depthDescription(depth: String): Int = when (depth) {
    RESEARCH_QUICK -> R.string.research_depth_quick_desc
    RESEARCH_DEEP -> R.string.research_depth_deep_desc
    else -> R.string.research_depth_standard_desc
}

@Composable
fun depthLabel(depth: String): String = stringResource(
    when (depth) {
        RESEARCH_QUICK -> R.string.research_depth_quick
        RESEARCH_DEEP -> R.string.research_depth_deep
        else -> R.string.research_depth_standard
    }
)
