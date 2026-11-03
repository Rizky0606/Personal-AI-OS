package app.aios.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.aios.android.R
import app.aios.android.ui.chat.activity.TraceApproval
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Keputusan izin yang dikirim ke server: `allow`/`deny`; `remember` = selalu izinkan untuk project ini. */
data class ApprovalDecision(val decision: String, val remember: Boolean)

private fun titleRes(kind: String): Int = when (kind) {
    "file_write" -> R.string.approval_title_file_write
    "network" -> R.string.approval_title_network
    else -> R.string.approval_title_command
}

/**
 * Panel izin di chat (paritas desktop P2/P6, ApprovalPanel.tsx): detail permintaan persis, folder kerja bila
 * ada, lalu tiga pilihan. Target sentuh 48 dp (Tokens.touchTarget); detail dibacakan TalkBack sebagai satu blok
 * sebelum tombol, judul dan folder kerja ikut terbaca lewat deskripsi semantik gabungan.
 */
@Composable
fun ApprovalPanel(
    approval: TraceApproval,
    busy: Boolean,
    onResolve: (ApprovalDecision) -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md)
    val title = stringResource(titleRes(approval.kind))
    val description = buildString {
        append(title)
        append(". ")
        append(stringResource(R.string.approval_detail_label))
        append(": ")
        append(approval.detail)
        if (approval.cwd != null) {
            append(". ")
            append(stringResource(R.string.approval_cwd))
            append(": ")
            append(approval.cwd)
        }
    }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .widthIn(max = Tokens.Space.s48 * 8)
            .clip(shape)
            .background(colors.surface, shape)
            .border(Hairline, colors.warning, shape)
            .padding(Tokens.Space.s16)
            .semantics(mergeDescendants = true) { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s12)
    ) {
        Text(text = title, style = AiosTheme.type.ui.copy(), color = colors.text)
        Text(
            text = approval.detail,
            style = AiosTheme.type.mono,
            color = colors.text2,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = Tokens.Space.s48 * 3)
                .background(colors.surface2, RoundedCornerShape(Tokens.Radius.sm))
                .padding(Tokens.Space.s8)
        )
        approval.cwd?.let { cwd ->
            Text(
                text = "${stringResource(R.string.approval_cwd)}: $cwd",
                style = AiosTheme.type.caption,
                color = colors.text3
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
            AiosButton(
                text = stringResource(R.string.approval_allow_once),
                onClick = { onResolve(ApprovalDecision("allow", false)) },
                kind = ButtonKind.Primary,
                enabled = !busy
            )
            AiosButton(
                text = stringResource(R.string.approval_allow_always),
                onClick = { onResolve(ApprovalDecision("allow", true)) },
                kind = ButtonKind.Secondary,
                enabled = !busy
            )
            AiosButton(
                text = stringResource(R.string.approval_deny),
                onClick = { onResolve(ApprovalDecision("deny", false)) },
                kind = ButtonKind.Danger,
                enabled = !busy
            )
        }
        if (approval.kind == "command") {
            Text(
                text = stringResource(R.string.approval_always_hint),
                style = AiosTheme.type.caption,
                color = colors.text3
            )
        }
    }
}
