package app.aios.android.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import app.aios.android.R
import app.aios.android.link.PushKeys

/** Kanal terpisah supaya pengguna bisa mematikan riset dan jadwal sendiri-sendiri. ID sama dengan gateway. */
object NotificationChannels {
    const val RESEARCH = "riset"
    const val SCHEDULE = "jadwal"
    const val GENERAL = "umum"

    fun forType(type: String?): String = when (type) {
        PushKeys.TYPE_RESEARCH_COMPLETED -> RESEARCH
        PushKeys.TYPE_SCHEDULE_RESULT -> SCHEDULE
        else -> GENERAL
    }

    /** Aman dipanggil berulang; hanya membuat yang belum ada. */
    fun create(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        listOf(
            Triple(RESEARCH, R.string.channel_research, R.string.channel_research_desc),
            Triple(SCHEDULE, R.string.channel_schedule, R.string.channel_schedule_desc),
            Triple(GENERAL, R.string.channel_general, R.string.channel_general_desc),
        ).forEach { (id, name, description) ->
            val channel = NotificationChannel(id, context.getString(name), NotificationManager.IMPORTANCE_DEFAULT)
            channel.description = context.getString(description)
            manager.createNotificationChannel(channel)
        }
    }
}
