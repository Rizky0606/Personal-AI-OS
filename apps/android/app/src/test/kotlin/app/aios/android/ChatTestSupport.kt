package app.aios.android

import app.aios.android.data.Connectivity
import app.aios.android.data.api.AUTHOR_ASSISTANT
import app.aios.android.data.api.AUTHOR_USER
import app.aios.android.data.api.Conversation
import app.aios.android.data.api.Message
import app.aios.android.data.api.MessagePart
import app.aios.android.data.api.ModelInfo
import app.aios.android.data.api.RoleInfo
import app.aios.android.data.api.Run
import app.aios.android.data.api.SendMessageResponse
import app.aios.android.data.chat.ChatRepository
import app.aios.android.data.chat.PickedFile
import app.aios.android.data.realtime.TokenSource
import app.aios.android.data.realtime.WsHandle
import app.aios.android.data.realtime.WsListener
import app.aios.android.data.realtime.WsTransport
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.io.IOException

const val TS = "2026-10-22T06:00:00.000Z"

class FakeConn(val token: String, private val listener: WsListener) : WsHandle {
    val sent = mutableListOf<String>()
    var closedWith: Int? = null

    override fun send(text: String): Boolean {
        sent += text
        return true
    }

    override fun close(code: Int, reason: String) {
        closedWith = code
    }

    fun open() = listener.onOpen()

    fun server(json: String) = listener.onMessage(json)

    fun drop() = listener.onFailure(IOException("putus"), null)

    fun closeFromServer(code: Int) = listener.onClosed(code, "")

    fun rejectHandshake(code: Int) = listener.onFailure(IOException("ditolak"), code)

    /** Frame subscribe yang dikirim klien, sebagai (channel, lastSeq). */
    fun subscribes(): List<Pair<String, Long>> = sent.mapNotNull { frame ->
        val type = Regex(""""type":"(\w+)"""").find(frame)?.groupValues?.get(1)
        if (type != "subscribe") return@mapNotNull null
        Regex(""""channel":"([^"]+)"""").find(frame)!!.groupValues[1] to
            (Regex(""""lastSeq":(\d+)""").find(frame)?.groupValues?.get(1)?.toLong() ?: 0L)
    }
}

class FakeWsTransport : WsTransport {
    val connections = mutableListOf<FakeConn>()
    val openTimes = mutableListOf<Long>()
    var clock: () -> Long = { 0L }

    override fun open(token: String, listener: WsListener): WsHandle {
        openTimes += clock()
        return FakeConn(token, listener).also { connections += it }
    }
}

class FakeTokens(var current: String? = "tok-1") : TokenSource {
    val refreshedCalls = mutableListOf<String>()
    var next: String? = "tok-2"

    override suspend fun token(): String? = current

    override suspend fun refreshed(stale: String): String? {
        refreshedCalls += stale
        current = next
        return next
    }
}

class FakeConnectivity(initial: Boolean = true) : Connectivity {
    val state = MutableStateFlow(initial)
    override val connected: Flow<Boolean> = state

    override fun isConnected() = state.value
}

fun envelope(channel: String, seq: Long, eventJson: String) =
    """{"v":1,"channel":"$channel","seq":$seq,"ts":"$TS","event":$eventJson}"""

fun delta(messageId: String, text: String) = """{"type":"message.delta","messageId":"$messageId","text":"$text"}"""

fun status(value: String) = """{"type":"run.status","status":"$value"}"""

fun subscribed(channel: String, lastSeq: Long = 0, replay: Boolean = true) =
    """{"type":"subscribed","channel":"$channel","lastSeq":$lastSeq,"replay":$replay}"""

fun run(
    id: String,
    status: String = "running",
    conversationId: String? = "c1",
    error: app.aios.android.data.api.RunError? = null
) = Run(id, "chat", "hermes", null, null, status, conversationId, error, TS, TS)

fun message(
    id: String,
    author: String,
    text: String,
    runId: String? = null,
    role: String? = null,
    conversationId: String = "c1"
) = Message(id, conversationId, author, listOf(MessagePart.Text(text)), role, null, runId, TS)

fun conversation(id: String, title: String = "Judul $id", pinned: Boolean = false, archived: Boolean = false) =
    Conversation(id, title, "android", null, pinned, if (archived) TS else null, TS, TS)

/** Repositori dalam memori: server kecil yang bisa diatur tes. */
class FakeChatRepo : ChatRepository {
    val stored = MutableStateFlow<Map<String, List<Message>>>(emptyMap())
    val convos = MutableStateFlow<List<Conversation>>(emptyList())
    val runs = mutableMapOf<String, Run>()
    var models = listOf(ModelInfo("router-fast", "Cepat", "combo"), ModelInfo("router-smart", "Cerdas", "combo"))
    var roles = listOf(
        RoleInfo("general", "Umum", "umum", "hermes", "general-cheap"),
        RoleInfo("writer", "Penulis", "umum", "hermes", "writer-model"),
        RoleInfo("frontend", "Frontend", "coding", "omp", "code-model")
    )

    val sendCalls = mutableListOf<Triple<String, String, String?>>()
    val rerouteCalls = mutableListOf<Pair<String, String>>()
    val cancelCalls = mutableListOf<String>()
    var refreshCalls = 0
    var createCalls = 0
    var failRefresh: Exception? = null
    var failSend: Exception? = null
    var hasMore = false

    /** Dipanggil saat refreshMessages dipanggil: tes mengisi hasil akhir server di sini. */
    var onRefresh: (String) -> Unit = {}
    var nextRunId = "r1"

    override fun conversations(query: String, archived: Boolean): Flow<List<Conversation>> = convos.map { list ->
        list.filter { (it.archivedAt != null) == archived && it.title.contains(query, ignoreCase = true) }
            .sortedWith(compareByDescending<Conversation> { it.pinned }.thenByDescending { it.updatedAt })
    }

    override fun conversation(id: String): Flow<Conversation?> = convos.map { l -> l.firstOrNull { it.id == id } }

    override fun messages(conversationId: String): Flow<List<Message>> = stored.map { it[conversationId].orEmpty() }

    fun put(conversationId: String, vararg msgs: Message) {
        stored.value = stored.value + (conversationId to (stored.value[conversationId].orEmpty() + msgs))
    }

    override suspend fun refreshConversations(archived: Boolean) {
        failRefresh?.let { throw it }
    }

    override suspend fun refreshMessages(conversationId: String): Boolean {
        refreshCalls++
        failRefresh?.let { throw it }
        onRefresh(conversationId)
        return hasMore
    }

    override suspend fun loadOlder(conversationId: String): Boolean = false

    override suspend fun createConversation(title: String?): Conversation {
        createCalls++
        return conversation(
            "new-$createCalls",
            title ?: "Judul new-$createCalls"
        ).also { convos.value = convos.value + it }
    }

    override suspend fun setPinned(id: String, pinned: Boolean) {
        convos.value = convos.value.map { if (it.id == id) it.copy(pinned = pinned) else it }
    }

    override suspend fun setArchived(id: String, archived: Boolean) {
        convos.value = convos.value.map { if (it.id == id) it.copy(archivedAt = if (archived) TS else null) else it }
    }

    override suspend fun delete(id: String) {
        convos.value = convos.value.filterNot { it.id == id }
    }

    val sentFiles = mutableListOf<List<MessagePart.File>>()
    val uploads = mutableListOf<String>()
    var failUpload: Exception? = null

    override suspend fun upload(file: PickedFile): MessagePart.File {
        uploads += file.name
        failUpload?.let { throw it }
        return MessagePart.File("f-${uploads.size}", file.name, file.mime)
    }

    override suspend fun send(
        conversationId: String,
        text: String,
        model: String?,
        files: List<MessagePart.File>
    ): SendMessageResponse {
        sendCalls += Triple(conversationId, text, model)
        sentFiles += files
        failSend?.let { throw it }
        val runId = nextRunId
        val user = message("u-$runId", AUTHOR_USER, text, runId, conversationId = conversationId)
        put(conversationId, user)
        runs[runId] = run(runId, "queued", conversationId)
        return SendMessageResponse(user, runs.getValue(runId))
    }

    val editCalls = mutableListOf<Pair<String, String>>()
    val deleteCalls = mutableListOf<String>()

    override suspend fun edit(
        conversationId: String,
        messageId: String,
        text: String,
        model: String?,
        files: List<MessagePart.File>
    ): SendMessageResponse {
        editCalls += messageId to text
        truncate(conversationId, messageId)
        return send(conversationId, text, model, files).also { sendCalls.removeAt(sendCalls.lastIndex) }
    }

    override suspend fun deleteMessage(conversationId: String, messageId: String) {
        deleteCalls += messageId
        truncate(conversationId, messageId)
    }

    private fun truncate(conversationId: String, fromId: String) {
        val list = stored.value[conversationId].orEmpty()
        val index = list.indexOfFirst { it.id == fromId }
        if (index >= 0) stored.value = stored.value + (conversationId to list.take(index))
    }

    override suspend fun reroute(messageId: String, role: String): Run {
        rerouteCalls += messageId to role
        runs["r2"] = run("r2", "queued")
        return runs.getValue("r2")
    }

    override suspend fun run(id: String): Run = runs[id] ?: throw IOException("run tidak ada")

    override suspend fun cancel(runId: String): Run {
        cancelCalls += runId
        return run(runId, "cancelled")
    }

    override suspend fun models() = models

    override suspend fun roles() = roles

    override suspend fun clearCache() {
        stored.value = emptyMap()
        convos.value = emptyList()
    }

    /** Menjadikan jawaban asisten tersimpan seperti yang dilakukan server setelah run selesai. */
    fun completeAssistant(conversationId: String, runId: String, text: String, role: String? = "general") {
        val others = stored.value[conversationId].orEmpty().filterNot { it.id == "a-$runId" }
        val answer = message("a-$runId", AUTHOR_ASSISTANT, text, runId, role, conversationId)
        stored.value = stored.value + (conversationId to (others + answer))
    }
}
