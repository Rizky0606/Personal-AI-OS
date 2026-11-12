package app.aios.android.ui.skills

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import app.aios.android.data.api.SKILL_STATUS_ARCHIVED
import app.aios.android.data.api.SkillSummary
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.StateHost
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Skill (P10): daftar katalog dengan sakelar aktif/nonaktif. Pengelolaan lain ada di aplikasi Windows. */
@Composable
fun SkillsScreen(online: Boolean, snackbar: SnackbarHostState, viewModel: SkillViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect { if (it is SkillEvent.Notice) snackbar.showSnackbar(context.getString(it.message)) }
    }
    val state = when {
        ui.loading -> ScreenState.Loading
        ui.error != null -> ScreenState.Error(stringResource(ui.error!!.messageRes))
        ui.items.isEmpty() -> ScreenState.Empty
        else -> ScreenState.Content
    }
    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            stringResource(R.string.skills_intro),
            style = AiosTheme.type.meta,
            color = AiosTheme.colors.text2,
            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16)
        )
        StateHost(
            state = state,
            offline = !online,
            emptyMessage = stringResource(R.string.skills_empty),
            onRetry = viewModel::refresh
        ) {
            LazyColumn {
                items(ui.items, key = { it.id }) { skill ->
                    SkillRow(skill = skill, enabled = online, onToggle = { viewModel.setActive(skill, it) })
                }
            }
        }
    }
}

@Composable
private fun SkillRow(skill: SkillSummary, enabled: Boolean, onToggle: (Boolean) -> Unit) {
    val colors = AiosTheme.colors
    val toggleLabel = stringResource(R.string.skills_toggle, skill.name)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .drawBehind {
                val y = size.height - Hairline.toPx() / 2
                val inset = Tokens.Space.s16.toPx()
                drawLine(colors.border, Offset(inset, y), Offset(size.width - inset, y), Hairline.toPx())
            }
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s12),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12)
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
            Text(
                text = skill.name,
                style = AiosTheme.type.ui,
                color = if (skill.isActive) colors.text else colors.text3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = skill.description,
                style = AiosTheme.type.meta,
                color = colors.text2,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = skillMeta(skill),
                style = AiosTheme.type.meta,
                color = colors.text3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Switch(
            checked = skill.isActive,
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
}

/** "Bawaan · v3 · Disematkan · Nonaktif": asal, versi, dan keadaan dalam teks (bukan warna saja). */
@Composable
private fun skillMeta(skill: SkillSummary): String {
    val source = stringResource(
        when (skill.source) {
            "builtin" -> R.string.skills_source_builtin
            "user" -> R.string.skills_source_user
            "installed" -> R.string.skills_source_installed
            else -> R.string.skills_source_agent
        }
    )
    val parts = mutableListOf(source, stringResource(R.string.skills_version, skill.version))
    if (skill.pinned == true) parts += stringResource(R.string.skills_pinned)
    if (!skill.isActive) {
        parts += stringResource(
            if (skill.status == SKILL_STATUS_ARCHIVED) {
                R.string.skills_status_archived
            } else {
                R.string.skills_status_disabled
            }
        )
    }
    return parts.joinToString(" · ")
}
