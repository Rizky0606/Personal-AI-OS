package app.aios.android.widget

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService
import android.widget.RemoteViews
import app.aios.android.MainActivity
import app.aios.android.R
import app.aios.android.link.AppLinks

/** Intent ke MainActivity dengan action yang diterjemahkan AppLinks (chat baru + suara, atau riset baru). */
private fun launch(context: Context, action: String) = Intent(context, MainActivity::class.java)
    .setAction(action)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

private fun pending(context: Context, action: String, requestCode: Int) = PendingIntent.getActivity(
    context,
    requestCode,
    launch(context, action),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
)

/** Widget layar utama (A15): dua tombol, tanpa data dari server sehingga tidak perlu diperbarui berkala. */
class QuickWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
        val views = RemoteViews(context.packageName, R.layout.widget_quick).apply {
            setOnClickPendingIntent(R.id.widget_quick_ask, pending(context, AppLinks.ACTION_QUICK_ASK, 1))
            setOnClickPendingIntent(R.id.widget_new_research, pending(context, AppLinks.ACTION_NEW_RESEARCH, 2))
        }
        widgetIds.forEach { manager.updateAppWidget(it, views) }
    }
}

/** Tile Quick Settings "Tanya AI" (A15): membuka chat baru yang langsung mendengarkan suara. */
class QuickAskTileService : TileService() {
    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        super.onClick()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(pending(this, AppLinks.ACTION_QUICK_ASK, 3))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(launch(this, AppLinks.ACTION_QUICK_ASK))
        }
    }
}
