package app.aios.android.debug

import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable

/** Build debug: katalog komponen untuk review visual. Tidak ada di release. */
object DebugFeatures {
    const val ENABLED = true
    const val ROUTE = "debug/catalog"
}

fun NavGraphBuilder.debugRoutes() {
    composable(DebugFeatures.ROUTE) { CatalogScreen() }
}
