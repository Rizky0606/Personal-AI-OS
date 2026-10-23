package app.aios.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.SnackbarData
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/**
 * Toast untuk umpan balik singkat. Permukaan solid dengan border tipis; bayangan satu-satunya
 * dari token elevasi karena snackbar adalah elemen melayang.
 */
@Composable
fun AiosSnackbarHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(hostState = state, modifier = modifier) { data -> AiosSnackbar(data) }
}

@Composable
private fun AiosSnackbar(data: SnackbarData) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    Row(
        modifier = Modifier
            .padding(Tokens.Space.s16)
            .fillMaxWidth()
            .shadow(Tokens.elevation, shape)
            .background(colors.surface2, shape)
            .border(Hairline, colors.border, shape)
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8),
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = data.visuals.message,
            style = AiosTheme.type.ui,
            color = colors.text,
            modifier = Modifier.weight(1f)
        )
        data.visuals.actionLabel?.let { label ->
            AiosButton(text = label, onClick = { data.performAction() }, kind = ButtonKind.Ghost)
        }
    }
}
