package app.aios.android.link

import android.content.Intent

/** Menerjemahkan Intent masuk (share atau ketukan notifikasi) menjadi [AppLink]; logikanya ada di [AppLinks]. */
object IntentLinks {
    private val pushKeys = listOf(
        PushKeys.TYPE,
        PushKeys.SCHEDULE_ID,
        PushKeys.CONVERSATION_ID,
        PushKeys.RESEARCH_ID,
    )

    fun from(intent: Intent?): AppLink? {
        intent ?: return null
        if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("text/") == true) {
            return AppLinks.fromShare(
                subject = intent.getStringExtra(Intent.EXTRA_SUBJECT),
                text = intent.getStringExtra(Intent.EXTRA_TEXT),
            )
        }
        // Notifikasi yang ditampilkan sistem membawa data FCM sebagai extras pada intent peluncur.
        val data = pushKeys.associateWith { intent.getStringExtra(it) }
        return AppLinks.fromPush(data)
    }
}
