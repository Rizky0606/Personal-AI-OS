package app.aios.android.ui.chat

import androidx.compose.runtime.Immutable
import app.aios.android.data.api.AUTHOR_ASSISTANT
import app.aios.android.data.api.AUTHOR_SYSTEM
import app.aios.android.data.api.AUTHOR_USER
import app.aios.android.data.api.Message
import app.aios.android.data.api.MessagePart

/** Baris yang digambar di daftar chat, urut kronologis (lama ke baru). Tidak berubah setelah dibuat. */
@Immutable
sealed interface ChatItem {
    val key: String

    data class User(val message: Message, val canEdit: Boolean) : ChatItem {
        override val key get() = message.id
    }

    data class PendingUser(val text: String) : ChatItem {
        override val key get() = "pending"
    }

    data class Assistant(
        val id: String,
        val text: String,
        val reasoning: String,
        val tools: List<ToolStep>,
        val role: String?,
        val model: String?,
        val streaming: Boolean,
        /** Chip role bisa diketuk (reroute) hanya pada jawaban terakhir yang sudah selesai. */
        val canReroute: Boolean
    ) : ChatItem {
        override val key get() = id
    }

    data class System(val message: Message) : ChatItem {
        override val key get() = message.id
    }

    data class Failure(val message: String, val retryable: Boolean) : ChatItem {
        override val key get() = "failure"
    }
}

/**
 * Menggabungkan pesan tersimpan dengan jawaban yang sedang mengalir. Pesan asisten milik run yang
 * sedang live digantikan oleh versi live (teks tersimpan masih kosong atau tertinggal); bila belum ada
 * barisnya di daftar, versi live ditambahkan di akhir.
 */
fun buildChatItems(state: ChatUiState): List<ChatItem> {
    val live = state.live
    val lastUserId = state.lastUserMessage?.id
    val lastAssistantId = state.lastAssistantMessage?.id
    val items = ArrayList<ChatItem>(state.messages.size + 3)
    var liveShown = false

    for (message in state.messages) {
        when (message.author) {
            AUTHOR_USER -> items += ChatItem.User(message, canEdit = message.id == lastUserId && !state.busy)
            AUTHOR_SYSTEM -> items += ChatItem.System(message)
            AUTHOR_ASSISTANT -> {
                if (live != null && message.runId == live.runId) {
                    items += liveItem(message.id, live, message)
                    liveShown = true
                } else {
                    items += ChatItem.Assistant(
                        id = message.id,
                        text = message.text,
                        reasoning = "",
                        tools = message.parts.filterIsInstance<MessagePart.Tool>().map { it.toStep() },
                        role = message.agentRole,
                        model = message.model,
                        streaming = false,
                        canReroute = message.id == lastAssistantId && !state.busy
                    )
                }
            }
        }
    }
    state.pending?.let { items += ChatItem.PendingUser(it.text) }
    if (live != null && !liveShown) items += liveItem(live.messageId ?: "live-${live.runId}", live, null)
    state.runError?.let {
        items += ChatItem.Failure(it.message, it.retryable)
    }
    return items
}

private fun liveItem(id: String, live: LiveRun, persisted: Message?) = ChatItem.Assistant(
    id = persisted?.id ?: id,
    text = live.text,
    reasoning = live.reasoning,
    tools = live.tools,
    role = live.role ?: persisted?.agentRole,
    model = persisted?.model,
    streaming = !live.finished,
    canReroute = false
)

private fun MessagePart.Tool.toStep() = ToolStep(toolCallId, name, target, status, durationMs)
