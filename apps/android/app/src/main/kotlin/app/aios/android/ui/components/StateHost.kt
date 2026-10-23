package app.aios.android.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** Lima state yang wajib didesain di setiap layar (DESIGN_SYSTEM.md, prinsip 5). */
sealed interface ScreenState {
    data object Loading : ScreenState

    data object Empty : ScreenState

    data object Content : ScreenState

    /** Gagal memuat; [message] sudah berupa teks tampilan dengan langkah berikutnya. */
    data class Error(val message: String) : ScreenState
}

/**
 * Memilih tampilan berdasarkan [state]. Offline ditampilkan sebagai pita di atas konten terakhir
 * (bukan menggantikannya), sehingga data yang sudah ada tetap terbaca.
 */
@Composable
fun StateHost(
    state: ScreenState,
    offline: Boolean,
    emptyMessage: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    emptyActionLabel: String? = null,
    onEmptyAction: (() -> Unit)? = null,
    skeleton: @Composable () -> Unit = { SkeletonList() },
    content: @Composable () -> Unit
) {
    Column(modifier = modifier.fillMaxSize()) {
        if (offline) OfflineBanner()
        when (state) {
            ScreenState.Loading -> skeleton()
            ScreenState.Empty -> EmptyState(emptyMessage, actionLabel = emptyActionLabel, onAction = onEmptyAction)
            ScreenState.Content -> content()
            is ScreenState.Error -> ErrorBanner(message = state.message, onRetry = onRetry)
        }
    }
}
