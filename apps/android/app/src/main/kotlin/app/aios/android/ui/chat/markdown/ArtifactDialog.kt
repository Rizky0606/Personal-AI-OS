package app.aios.android.ui.chat.markdown

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.aios.android.R
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Origin buatan untuk halaman artifact: https agar skrip CDN dan SRI berjalan, dan tidak pernah terselesaikan. */
private const val ARTIFACT_ORIGIN = "https://artifact.aios.invalid/"

const val ARTIFACT_WEBVIEW_TAG = "artifact-webview"

private fun Color.css(): String = "#%06X".format(toArgb() and 0xFFFFFF)

/**
 * Pratinjau layar penuh untuk satu blok kode. WebView tanpa jembatan JS, tanpa akses berkas atau content provider,
 * dan semua navigasi ke luar halaman ditolak: kode buatan AI boleh berjalan tetapi tidak bisa menyentuh aplikasi.
 */
@Composable
fun ArtifactDialog(kind: ArtifactKind, language: String, code: String, onDismiss: () -> Unit) {
    val colors = AiosTheme.colors
    val html = remember(kind, code, colors) {
        ArtifactPage.build(
            kind,
            code,
            ArtifactTheme(
                dark = colors.bg.luminance() < 0.5f,
                bg = colors.bg.css(),
                surface = colors.surface.css(),
                text = colors.text.css(),
                danger = colors.danger.css()
            )
        )
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.bg)
                .systemBarsPadding()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.surface)
                    .padding(start = Tokens.Space.s16),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(R.string.chat_artifact_title, language.ifBlank { kind.name.lowercase() }),
                    style = AiosTheme.type.ui.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.text,
                    modifier = Modifier.weight(1f)
                )
                Box(
                    modifier = Modifier
                        .size(Tokens.touchTarget)
                        .clickable(role = Role.Button, onClick = onDismiss),
                    contentAlignment = Alignment.Center
                ) { AiosIcon(R.drawable.ic_close, contentDescription = stringResource(R.string.chat_artifact_close)) }
            }
            Box(Modifier.fillMaxWidth().height(Hairline).background(colors.border))
            ArtifactWebView(html, Modifier.fillMaxSize().testTag(ARTIFACT_WEBVIEW_TAG))
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ArtifactWebView(html: String, modifier: Modifier) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.setSupportMultipleWindows(false)
                settings.javaScriptCanOpenWindowsAutomatically = false
                webViewClient = object : WebViewClient() {
                    // Halaman tetap di dalam pratinjau: tautan dan pengalihan tidak dibuka.
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                }
            }
        },
        update = { view ->
            if (view.tag != html) {
                view.tag = html
                view.loadDataWithBaseURL(ARTIFACT_ORIGIN, html, "text/html", "utf-8", null)
            }
        },
        onRelease = { it.destroy() }
    )
}
