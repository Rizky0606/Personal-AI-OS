package app.aios.android.debug

import androidx.navigation.NavGraphBuilder

/** Build release: tidak ada fitur debug. Pasangannya ada di src/debug. */
object DebugFeatures {
    const val ENABLED = false
    const val ROUTE = "debug/catalog"
}

fun NavGraphBuilder.debugRoutes() = Unit
