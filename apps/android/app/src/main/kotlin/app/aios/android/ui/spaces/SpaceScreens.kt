package app.aios.android.ui.spaces

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.aios.android.R
import app.aios.android.data.api.Space
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.ScreenState
import app.aios.android.ui.components.StateHost
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Dokumen yang bisa diindeks gateway (PDF, DOCX, teks). */
private val DOCUMENT_TYPES = arrayOf(
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/*"
)

@Composable
private fun SpaceNotices(
    events: kotlinx.coroutines.flow.Flow<SpaceEvent>,
    snackbar: SnackbarHostState,
    onEvent: (SpaceEvent) -> Unit = {}
) {
    val context = LocalContext.current
    LaunchedEffect(events) {
        events.collect { event ->
            if (event is SpaceEvent.Notice) {
                snackbar.showSnackbar(
                    if (event.arg != null) {
                        context.getString(
                            event.message,
                            event.arg
                        )
                    } else {
                        context.getString(event.message)
                    }
                )
            }
            onEvent(event)
        }
    }
}

/** Ruang pengetahuan (A13): daftar ruang dan formulir ruang baru. */
@Composable
fun SpaceListScreen(
    online: Boolean,
    snackbar: SnackbarHostState,
    onOpen: (String) -> Unit,
    viewModel: SpaceListViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    SpaceNotices(viewModel.events, snackbar) { if (it is SpaceEvent.Created) onOpen(it.id) }
    val state = when {
        ui.loading -> ScreenState.Loading
        ui.error != null -> ScreenState.Error(stringResource(ui.error!!.messageRes))
        ui.items.isEmpty() -> ScreenState.Empty
        else -> ScreenState.Content
    }
    Column(modifier = Modifier.fillMaxSize().imePadding()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
        ) {
            Text(stringResource(R.string.space_intro), style = AiosTheme.type.meta, color = AiosTheme.colors.text2)
            AiosTextField(
                value = ui.name,
                onValueChange = viewModel::onName,
                label = stringResource(R.string.space_name),
                placeholder = stringResource(R.string.space_name_hint),
                enabled = online && !ui.creating
            )
            AiosButton(
                text = stringResource(if (ui.creating) R.string.space_creating else R.string.space_create),
                onClick = viewModel::create,
                kind = ButtonKind.Primary,
                enabled = online && !ui.creating && ui.name.isNotBlank(),
                modifier = Modifier.fillMaxWidth()
            )
        }
        StateHost(
            state = state,
            offline = !online,
            emptyMessage = stringResource(R.string.space_empty),
            onRetry = viewModel::refresh
        ) {
            LazyColumn {
                items(ui.items, key = { it.id }) { space ->
                    AiosListItem(
                        title = space.name,
                        supporting = pluralStringResource(
                            R.plurals.space_doc_count,
                            space.documentCount,
                            space.documentCount
                        ),
                        onClick = { onOpen(space.id) }
                    )
                }
            }
        }
    }
}

/** Satu ruang: dokumen (tambah, keluarkan), chat baru yang memakai dokumen sebagai sumber, dan hapus ruang. */
@Composable
fun SpaceDetailScreen(
    online: Boolean,
    snackbar: SnackbarHostState,
    onChat: (Space) -> Unit,
    onDeleted: () -> Unit,
    viewModel: SpaceDetailViewModel = hiltViewModel()
) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    var confirmDelete by remember { mutableStateOf(false) }
    SpaceNotices(viewModel.events, snackbar) { if (it is SpaceEvent.Deleted) onDeleted() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        viewModel.addFiles(uris.map { it.toString() })
    }
    val state = when {
        ui.loading -> ScreenState.Loading
        ui.error != null -> ScreenState.Error(stringResource(ui.error!!.messageRes))
        ui.space == null -> ScreenState.Error(stringResource(R.string.space_not_found))
        else -> ScreenState.Content
    }
    val colors = AiosTheme.colors
    StateHost(state = state, offline = !online, emptyMessage = "", onRetry = viewModel::refresh) {
        val space = ui.space ?: return@StateHost
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            item(key = "header") {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(Tokens.Space.s16),
                    verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
                ) {
                    Text(space.name, style = AiosTheme.type.section, color = colors.text)
                    if (space.description.isNotBlank()) {
                        Text(space.description, style = AiosTheme.type.ui, color = colors.text2)
                    }
                    AiosButton(
                        text = stringResource(R.string.space_new_chat),
                        onClick = { onChat(space) },
                        kind = ButtonKind.Primary,
                        enabled = online,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        AiosButton(
                            text = ui.adding?.let { stringResource(R.string.space_adding, it) }
                                ?: stringResource(R.string.space_add_doc),
                            onClick = { picker.launch(DOCUMENT_TYPES) },
                            kind = ButtonKind.Secondary,
                            enabled = online && ui.adding == null,
                            modifier = Modifier.weight(1f)
                        )
                        AiosButton(
                            text = stringResource(R.string.space_delete),
                            onClick = { confirmDelete = true },
                            kind = ButtonKind.Danger
                        )
                    }
                    Text(stringResource(R.string.space_documents), style = AiosTheme.type.uiStrong, color = colors.text)
                    if (ui.documents.isEmpty()) {
                        Text(
                            stringResource(R.string.space_documents_empty),
                            style = AiosTheme.type.ui,
                            color = colors.text2
                        )
                    }
                }
            }
            items(ui.documents, key = { it.id }) { document ->
                AiosListItem(
                    title = document.name,
                    supporting = stringResource(R.string.space_doc_meta, document.chars, document.chunks),
                    trailingContent = {
                        AiosButton(
                            stringResource(R.string.space_doc_remove),
                            onClick = { viewModel.removeDocument(document) },
                            kind = ButtonKind.Ghost,
                            enabled = online
                        )
                    }
                )
            }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            containerColor = colors.surface,
            title = {
                Text(
                    stringResource(R.string.space_delete_title),
                    style = AiosTheme.type.section,
                    color = colors.text
                )
            },
            text = {
                Text(
                    stringResource(R.string.space_delete_body),
                    style = AiosTheme.type.ui,
                    color = colors.text2
                )
            },
            confirmButton = {
                AiosButton(
                    stringResource(R.string.space_delete),
                    onClick = {
                        confirmDelete = false
                        viewModel.delete()
                    },
                    kind = ButtonKind.Danger
                )
            },
            dismissButton = {
                AiosButton(
                    stringResource(R.string.memory_cancel),
                    onClick = { confirmDelete = false },
                    kind = ButtonKind.Ghost
                )
            }
        )
    }
}
