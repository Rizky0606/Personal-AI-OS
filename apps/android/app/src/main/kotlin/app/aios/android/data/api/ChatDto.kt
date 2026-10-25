@file:OptIn(ExperimentalSerializationApi::class)

package app.aios.android.data.api

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/* Model chat mengikuti packages/contracts (entities.ts, api-schemas.ts). Ubah bersama kontrak. */

const val SURFACE_ANDROID = "android"
const val AUTHOR_USER = "user"
const val AUTHOR_ASSISTANT = "assistant"
const val AUTHOR_SYSTEM = "system"

@Serializable
data class Page<T>(val items: List<T>, val nextBefore: String? = null)

@Serializable
data class Conversation(
    val id: String,
    val title: String,
    val surface: String,
    val projectId: String? = null,
    val pinned: Boolean = false,
    val archivedAt: String? = null,
    val createdAt: String,
    val updatedAt: String,
    /** Ruang pengetahuan (A13); tidak disimpan di cache Room karena hanya dipakai saat membuat percakapan. */
    val spaceId: String? = null
)

@Serializable
data class CreateConversationRequest(val surface: String, val title: String? = null, val spaceId: String? = null)

@Serializable
data class UpdateConversationRequest(
    val title: String? = null,
    val pinned: Boolean? = null,
    val archived: Boolean? = null
)

/**
 * Bagian pesan; `type` ikut dienkode agar salinan di cache Room bisa dibaca ulang.
 * Tipe yang belum dikenal klien lama jatuh ke [Unknown] agar riwayat tetap terbaca. */
@Serializable(with = MessagePartSerializer::class)
sealed interface MessagePart {
    @Serializable
    data class Text(
        val text: String,
        @EncodeDefault val type: String = "text"
    ) : MessagePart

    @Serializable
    data class File(
        val fileId: String,
        val name: String,
        val mime: String,
        @EncodeDefault val type: String = "file"
    ) : MessagePart

    @Serializable
    data class Tool(
        val toolCallId: String,
        val name: String,
        val target: String? = null,
        val status: String,
        val durationMs: Long? = null,
        @EncodeDefault val type: String = "tool"
    ) : MessagePart

    @Serializable
    data class Unknown(val type: String = "") : MessagePart
}

object MessagePartSerializer : JsonContentPolymorphicSerializer<MessagePart>(MessagePart::class) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<MessagePart> =
        when (element.jsonObject["type"]?.jsonPrimitive?.content) {
            "text" -> MessagePart.Text.serializer()
            "file" -> MessagePart.File.serializer()
            "tool" -> MessagePart.Tool.serializer()
            else -> MessagePart.Unknown.serializer()
        }
}

@Serializable
data class Message(
    val id: String,
    val conversationId: String,
    val author: String,
    val parts: List<MessagePart> = emptyList(),
    val agentRole: String? = null,
    val model: String? = null,
    val runId: String? = null,
    val createdAt: String
) {
    /** Teks gabungan semua bagian teks. */
    val text: String
        get() = parts.filterIsInstance<MessagePart.Text>().joinToString("") { it.text }
}

@Serializable
data class RunError(val code: String, val message: String, val retryable: Boolean = false)

@Serializable
data class Run(
    val id: String,
    val kind: String,
    val engine: String,
    val agentRole: String? = null,
    val model: String? = null,
    val status: String,
    val conversationId: String? = null,
    val error: RunError? = null,
    val createdAt: String,
    val updatedAt: String
)

/** Bagian yang dikirim pengguna: teks, atau lampiran yang sudah diunggah ke `/files`. */
@Serializable
data class InputPart(
    val type: String,
    val text: String? = null,
    val fileId: String? = null,
    val name: String? = null,
    val mime: String? = null
) {
    companion object {
        fun text(value: String) = InputPart(type = "text", text = value)

        fun file(part: MessagePart.File) =
            InputPart(type = "file", fileId = part.fileId, name = part.name, mime = part.mime)

        /** Teks (bila ada) lalu lampiran; server menolak pesan tanpa keduanya. */
        fun of(text: String, files: List<MessagePart.File>) =
            (if (text.isNotBlank()) listOf(text(text)) else emptyList()) + files.map(::file)
    }
}

/** Hasil `POST /files`. */
@Serializable
data class FileRecord(val id: String, val name: String, val mime: String, val size: Long)

@Serializable
data class SendMessageRequest(
    val parts: List<InputPart>,
    val role: String? = null,
    val model: String? = null
)

@Serializable
data class SendMessageResponse(val message: Message, val run: Run)

@Serializable
data class RerouteRequest(val role: String)

@Serializable
data class RerouteResponse(val run: Run)

@Serializable
data class ModelInfo(
    val id: String,
    val label: String,
    val kind: String = "model",
    val ownedBy: String = ""
)

@Serializable
data class ModelList(val items: List<ModelInfo>)

@Serializable
data class RoleInfo(
    val id: String,
    val name: String,
    val group: String,
    val engine: String,
    val model: String = ""
)

@Serializable
data class RoleList(val items: List<RoleInfo>)

/** Status run yang berarti tidak akan ada event baru untuk chat. */
val TERMINAL_RUN_STATUSES = setOf("completed", "failed", "cancelled", "accepted", "rejected")
