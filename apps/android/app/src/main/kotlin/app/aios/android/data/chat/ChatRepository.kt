package app.aios.android.data.chat

import app.aios.android.data.api.ChatApi
import app.aios.android.data.api.Conversation
import app.aios.android.data.api.CreateConversationRequest
import app.aios.android.data.api.InputPart
import app.aios.android.data.api.Message
import app.aios.android.data.api.MessagePart
import app.aios.android.data.api.ModelInfo
import app.aios.android.data.api.RerouteRequest
import app.aios.android.data.api.RoleInfo
import app.aios.android.data.api.Run
import app.aios.android.data.api.SURFACE_ANDROID
import app.aios.android.data.api.SendMessageRequest
import app.aios.android.data.api.SendMessageResponse
import app.aios.android.data.api.UpdateConversationRequest
import app.aios.android.data.db.ChatDao
import app.aios.android.data.db.ConversationEntity
import app.aios.android.data.db.MessageEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.HttpException

/**
 * Percakapan dan pesan. Room adalah cache: layar membaca dari Room (instan, tersedia offline) dan
 * `refresh*` menyegarkannya dari server. Semua fungsi suspend melempar exception jaringan/HTTP apa
 * adanya; pemanggil (ViewModel) memetakannya dengan `toApiError`.
 */
interface ChatRepository {
    fun conversations(query: String, archived: Boolean): Flow<List<Conversation>>

    fun conversation(id: String): Flow<Conversation?>

    fun messages(conversationId: String): Flow<List<Message>>

    suspend fun refreshConversations(archived: Boolean)

    /** Menyegarkan halaman pesan terbaru. Mengembalikan true bila masih ada pesan yang lebih lama. */
    suspend fun refreshMessages(conversationId: String): Boolean

    /** Memuat halaman yang lebih lama dari pesan tertua di cache. Mengembalikan true bila masih ada lagi. */
    suspend fun loadOlder(conversationId: String): Boolean

    suspend fun createConversation(title: String? = null, spaceId: String? = null): Conversation

    suspend fun setPinned(id: String, pinned: Boolean)

    suspend fun setArchived(id: String, archived: Boolean)

    suspend fun delete(id: String)

    suspend fun send(
        conversationId: String,
        text: String,
        model: String?,
        files: List<MessagePart.File> = emptyList()
    ): SendMessageResponse

    /** Mengunggah lampiran; hasilnya dirujuk dari pesan lewat part `file`. */
    suspend fun upload(file: PickedFile): MessagePart.File

    /** Mengubah pesan pengguna: pesan itu dan semua sesudahnya dibuang, lalu teks baru dikirim. */
    suspend fun edit(
        conversationId: String,
        messageId: String,
        text: String,
        model: String?,
        files: List<MessagePart.File> = emptyList()
    ): SendMessageResponse

    /** Menghapus pesan beserta semua pesan sesudahnya. */
    suspend fun deleteMessage(conversationId: String, messageId: String)

    suspend fun reroute(messageId: String, role: String): Run

    suspend fun run(id: String): Run

    suspend fun cancel(runId: String): Run

    suspend fun models(): List<ModelInfo>

    suspend fun roles(): List<RoleInfo>

    /** Menghapus seluruh cache chat (saat logout). */
    suspend fun clearCache()
}

class RoomChatRepository(
    private val api: ChatApi,
    private val dao: ChatDao,
    private val json: Json
) : ChatRepository {
    private val partsSerializer = ListSerializer(MessagePart.serializer())

    override fun conversations(query: String, archived: Boolean): Flow<List<Conversation>> =
        dao.observeConversations(escapeLike(query.trim()), if (archived) 1 else 0)
            .map { rows -> rows.map { it.toDomain() } }

    override fun conversation(id: String): Flow<Conversation?> = dao.observeConversation(id).map { it?.toDomain() }

    override fun messages(conversationId: String): Flow<List<Message>> =
        dao.observeMessages(conversationId).map { rows -> rows.map { it.toDomain() } }

    override suspend fun refreshConversations(archived: Boolean) {
        var before: String? = null
        var pages = 0
        do {
            val page = api.listConversations(before = before, archived = archived.toString())
            dao.upsertConversations(page.items.map { it.toEntity() })
            before = page.nextBefore
            pages++
        } while (before != null && pages < MAX_CONVERSATION_PAGES)
    }

    override suspend fun refreshMessages(conversationId: String): Boolean {
        val page = api.listMessages(conversationId)
        dao.upsertMessages(page.items.map { it.toEntity() })
        // Halaman terbaru adalah kebenaran untuk rentangnya: pesan yang sudah dihapus di server ikut dibuang.
        val oldest = page.items.firstOrNull()?.id
        if (oldest == null) {
            dao.deleteMessages(conversationId)
        } else {
            dao.deleteMissingFrom(conversationId, oldest, page.items.map { it.id })
        }
        return page.nextBefore != null
    }

    override suspend fun loadOlder(conversationId: String): Boolean {
        val oldest = dao.oldestMessageId(conversationId) ?: return false
        val page = api.listMessages(conversationId, before = oldest)
        dao.upsertMessages(page.items.map { it.toEntity() })
        return page.nextBefore != null
    }

    override suspend fun createConversation(title: String?, spaceId: String?): Conversation {
        val created = api.createConversation(
            CreateConversationRequest(surface = SURFACE_ANDROID, title = title, spaceId = spaceId)
        )
        dao.upsertConversations(listOf(created.toEntity()))
        return created
    }

    override suspend fun setPinned(id: String, pinned: Boolean) {
        val updated = api.updateConversation(id, UpdateConversationRequest(pinned = pinned))
        dao.upsertConversations(listOf(updated.toEntity()))
    }

    override suspend fun setArchived(id: String, archived: Boolean) {
        val updated = api.updateConversation(id, UpdateConversationRequest(archived = archived))
        dao.upsertConversations(listOf(updated.toEntity()))
    }

    override suspend fun delete(id: String) {
        api.archiveConversation(id)
        dao.deleteConversation(id)
    }

    override suspend fun send(
        conversationId: String,
        text: String,
        model: String?,
        files: List<MessagePart.File>
    ): SendMessageResponse {
        val response = api.sendMessage(
            conversationId,
            SendMessageRequest(parts = InputPart.of(text, files), model = model)
        )
        dao.upsertMessages(listOf(response.message.toEntity()))
        return response
    }

    override suspend fun edit(
        conversationId: String,
        messageId: String,
        text: String,
        model: String?,
        files: List<MessagePart.File>
    ): SendMessageResponse {
        val response = api.editMessage(
            messageId,
            SendMessageRequest(parts = InputPart.of(text, files), model = model)
        )
        dao.deleteMessagesFrom(conversationId, messageId)
        dao.upsertMessages(listOf(response.message.toEntity()))
        return response
    }

    override suspend fun upload(file: PickedFile): MessagePart.File {
        val body = file.bytes.toRequestBody(file.mime.toMediaTypeOrNull())
        val record = api.uploadFile(MultipartBody.Part.createFormData("file", file.name, body))
        return MessagePart.File(fileId = record.id, name = record.name, mime = record.mime)
    }

    override suspend fun deleteMessage(conversationId: String, messageId: String) {
        val response = api.deleteMessage(messageId)
        if (!response.isSuccessful) throw HttpException(response)
        dao.deleteMessagesFrom(conversationId, messageId)
    }

    override suspend fun reroute(messageId: String, role: String): Run =
        api.reroute(messageId, RerouteRequest(role)).run

    override suspend fun run(id: String): Run = api.getRun(id)

    override suspend fun cancel(runId: String): Run = api.cancelRun(runId)

    override suspend fun models(): List<ModelInfo> = api.listModels().items

    override suspend fun roles(): List<RoleInfo> = api.listRoles().items

    override suspend fun clearCache() = dao.clearChat()

    private fun Message.toEntity() = MessageEntity(
        id = id,
        conversationId = conversationId,
        author = author,
        partsJson = json.encodeToString(partsSerializer, parts),
        agentRole = agentRole,
        model = model,
        runId = runId,
        createdAt = createdAt
    )

    private fun MessageEntity.toDomain() = Message(
        id = id,
        conversationId = conversationId,
        author = author,
        parts = runCatching { json.decodeFromString(partsSerializer, partsJson) }.getOrDefault(emptyList()),
        agentRole = agentRole,
        model = model,
        runId = runId,
        createdAt = createdAt
    )

    private fun Conversation.toEntity() =
        ConversationEntity(id, title, surface, projectId, pinned, archivedAt, createdAt, updatedAt)

    private fun ConversationEntity.toDomain() =
        Conversation(id, title, surface, projectId, pinned, archivedAt, createdAt, updatedAt)

    private companion object {
        const val MAX_CONVERSATION_PAGES = 20

        /** Escape untuk `LIKE ... ESCAPE '\'`. */
        fun escapeLike(raw: String) = raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    }
}
