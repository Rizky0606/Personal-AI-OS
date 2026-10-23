package app.aios.android.link

/** Tujuan yang datang dari luar aplikasi (tap notifikasi, share intent) dan harus membuka layar tertentu. */
sealed interface AppLink {
    /** Teks atau URL dari aplikasi lain: membuka chat baru dengan isian terisi, belum terkirim. */
    data class SharedText(val text: String) : AppLink

    data class OpenResearch(val researchId: String) : AppLink

    /** Hasil jadwal tersimpan sebagai pesan di percakapan khusus jadwal itu. */
    data class OpenConversation(val conversationId: String) : AppLink

    data class OpenSchedule(val scheduleId: String) : AppLink
}

/** Kunci data FCM (sama dengan payload gateway: apps/gateway/src/modules/push/service.ts). */
object PushKeys {
    const val TYPE = "type"
    const val SCHEDULE_ID = "scheduleId"
    const val CONVERSATION_ID = "conversationId"
    const val RESEARCH_ID = "researchId"
    const val TYPE_SCHEDULE_RESULT = "schedule.result"
    const val TYPE_RESEARCH_COMPLETED = "research.completed"
}

object AppLinks {
    private const val MAX_SHARED_CHARS = 20_000

    /** Dari data notifikasi. Jenis yang tidak dikenal (mis. notifikasi uji) tidak membuka apa-apa. */
    fun fromPush(data: Map<String, String?>): AppLink? {
        fun value(key: String) = data[key]?.takeIf { it.isNotBlank() }
        return when (data[PushKeys.TYPE]) {
            PushKeys.TYPE_RESEARCH_COMPLETED -> value(PushKeys.RESEARCH_ID)?.let(AppLink::OpenResearch)
            PushKeys.TYPE_SCHEDULE_RESULT ->
                value(PushKeys.CONVERSATION_ID)?.let(AppLink::OpenConversation)
                    ?: value(PushKeys.SCHEDULE_ID)?.let(AppLink::OpenSchedule)
            else -> null
        }
    }

    /** Dari share intent: subjek (judul halaman) ikut bila belum ada di teks. Kosong = tidak ada tautan. */
    fun fromShare(subject: String?, text: String?): AppLink.SharedText? {
        val body = text?.trim().orEmpty()
        val title = subject?.trim().orEmpty()
        val combined = when {
            body.isEmpty() -> title
            title.isEmpty() || body.contains(title) -> body
            else -> "$title\n$body"
        }
        return combined.takeIf { it.isNotEmpty() }?.take(MAX_SHARED_CHARS)?.let(AppLink::SharedText)
    }
}
