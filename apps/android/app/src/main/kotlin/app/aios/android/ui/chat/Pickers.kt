package app.aios.android.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.aios.android.R
import app.aios.android.data.api.ModelInfo
import app.aios.android.data.api.RoleInfo
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Role yang bisa dijalankan dari ponsel: bukan role coding (engine omp butuh worker Windows). */
fun selectableRoles(roles: List<RoleInfo>): List<RoleInfo> = roles.filter { it.engine != "omp" }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelSheet(models: List<ModelInfo>, selected: String?, onSelect: (String?) -> Unit, onDismiss: () -> Unit) {
    SheetFrame(title = stringResource(R.string.chat_model_picker_title), onDismiss = onDismiss) {
        Text(
            text = stringResource(R.string.chat_model_picker_auto_hint),
            style = AiosTheme.type.meta,
            color = AiosTheme.colors.text2,
            modifier = Modifier.padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8)
        )
        LazyColumn {
            item(key = "auto") {
                PickRow(stringResource(R.string.chat_model_auto), null, selected == null) { onSelect(null) }
            }
            items(models, key = { it.id }) { model ->
                PickRow(model.label, model.id.takeIf { it != model.label }, selected == model.id) { onSelect(model.id) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoleSheet(roles: List<RoleInfo>, current: String?, onSelect: (String) -> Unit, onDismiss: () -> Unit) {
    SheetFrame(title = stringResource(R.string.chat_role_picker_title), onDismiss = onDismiss) {
        Text(
            text = stringResource(R.string.chat_role_picker_hint),
            style = AiosTheme.type.meta,
            color = AiosTheme.colors.text2,
            modifier = Modifier.padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8)
        )
        LazyColumn {
            items(selectableRoles(roles), key = { it.id }) { role ->
                PickRow(role.name, role.model.ifBlank { null }, role.id == current) { onSelect(role.id) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetFrame(title: String, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val colors = AiosTheme.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.surface,
        contentColor = colors.text,
        shape = RoundedCornerShape(topStart = Tokens.Radius.lg, topEnd = Tokens.Radius.lg),
        dragHandle = null
    ) {
        Column(modifier = Modifier.fillMaxWidth().navigationBarsPadding()) {
            Text(
                text = title,
                style = AiosTheme.type.section,
                color = colors.text,
                modifier = Modifier.padding(start = Tokens.Space.s16, end = Tokens.Space.s16, top = Tokens.Space.s20)
            )
            content()
        }
    }
}

@Composable
private fun PickRow(title: String, supporting: String?, selected: Boolean, onClick: () -> Unit) {
    AiosListItem(
        title = title,
        supporting = supporting,
        onClick = onClick,
        trailingContent = if (selected) {
            { AiosIcon(R.drawable.ic_check, contentDescription = null, tint = AiosTheme.colors.accent) }
        } else {
            null
        }
    )
}
