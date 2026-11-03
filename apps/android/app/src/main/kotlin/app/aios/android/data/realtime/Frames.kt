@file:Suppress("MaxLineLength")

package app.aios.android.data.realtime

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.time.Instant

/** Event run dan percakapan yang dipakai chat. Tipe lain (diff, riset, dll.) menjadi [Other]. */
sealed interface ServerEvent {
    data class RunStatus(val status: String) : ServerEvent

    data class RouteDecided(val role: String, val confidence: Double, val reason: String) : ServerEvent

    data class MessageDelta(val messageId: String, val text: String) : ServerEvent

    data class MessageCompleted(val messageId: String) : ServerEvent

    data class ReasoningDelta(val messageId: String, val text: String) : ServerEvent

    /** Judul ringkas dari mesin untuk baris aktivitas. */
    data class ReasoningSummary(val messageId: String, val text: String) : ServerEvent

    data class ApprovalRequested(
        val approvalId: String,
        val kind: String,
        val detail: String,
        val cwd: String?,
        val toolCallId: String?
    ) : ServerEvent

    data class ApprovalResolved(val approvalId: String, val decision: String, val remember: Boolean) : ServerEvent

    data class ToolStarted(val toolCallId: String, val name: String, val target: String?) : ServerEvent

    data class ToolOutput(val toolCallId: String, val chunk: String, val stream: String?) : ServerEvent

    data class ToolFinished(val toolCallId: String, val status: String, val durationMs: Long) : ServerEvent

    data class Failure(val code: String, val message: String, val retryable: Boolean) : ServerEvent

    data class Other(val type: String) : ServerEvent

    data class RunCompleted(val summary: String) : ServerEvent

    /** Tahap riset: planning, searching, reading, writing. */
    data class ResearchProgress(val stage: String, val progress: Double, val message: String?) : ServerEvent

    data class ResearchSourceFound(val sourceId: String, val url: String, val title: String) : ServerEvent

    /** Channel `user`: sebuah run jadwal berubah status (succeeded, failed, missed, running). */
    data class ScheduleResult(val scheduleId: String, val status: String) : ServerEvent

    /** Channel `user`: sebuah job riset selesai. */
    data class ResearchCompleted(val researchId: String, val runId: String?) : ServerEvent

    data class ArtifactCreated(
        val fileId: String,
        val name: String,
        val mime: String,
        val size: Long,
        val sha256: String,
        val source: String
    ) : ServerEvent

    /** Rencana agent terbaru (tool `todo`); selalu seluruh daftar, bukan selisih. */
    data class TodoUpdated(val phases: List<TodoPhase>) : ServerEvent

    /** Konteks dipakai run (dikirim sekali, setelah role/skill dipilih dan memori dibaca). */
    data class ContextUsed(
        val runId: String,
        val engine: String?,
        val model: String?,
        val skills: List<String>,
        val memory: ContextMemory,
        val attachments: List<ContextAttachment>
    ) : ServerEvent
}

@Serializable
data class TodoTask(val content: String, val status: String, val blocker: String? = null)

@Serializable
data class TodoPhase(val name: String, val tasks: List<TodoTask>)
data class ContextMemoryItem(val id: String, val title: String)
data class ContextMemory(val read: Int, val items: List<ContextMemoryItem>)
data class ContextAttachment(val fileId: String, val name: String, val mime: String)

/** Frame dari server di `/v1/ws`. */
sealed interface Frame {
    /** [ts]: waktu event di server (ms epoch); null bila tidak ada atau tak terbaca. */
    data class Envelope(val channel: String, val seq: Long, val event: ServerEvent, val ts: Long? = null) : Frame

    data class Subscribed(val channel: String, val lastSeq: Long, val replay: Boolean) : Frame

    data object Pong : Frame

    data class ProtocolError(val code: String, val message: String, val channel: String?) : Frame

    /** Frame yang tidak dikenali atau rusak; diabaikan, koneksi tetap hidup. */
    data object Unknown : Frame
}

@Serializable
private data class SubscribeFrame(val type: String, val channel: String, val lastSeq: Long? = null)

object Frames {
    private val encoder = Json { explicitNulls = false }

    fun subscribe(channel: String, lastSeq: Long): String =
        encoder.encodeToString(SubscribeFrame.serializer(), SubscribeFrame("subscribe", channel, lastSeq))

    fun unsubscribe(channel: String): String =
        encoder.encodeToString(SubscribeFrame.serializer(), SubscribeFrame("unsubscribe", channel))

    /** Mengurai satu pesan teks WebSocket; tidak pernah melempar. */
    fun parse(text: String, json: Json): Frame = runCatching {
        val obj = json.parseToJsonElement(text).jsonObject
        when (obj["type"]?.jsonPrimitive?.contentOrNull) {
            "pong" -> Frame.Pong
            "subscribed" -> Frame.Subscribed(
                channel = obj.str("channel"),
                lastSeq = obj["lastSeq"]?.jsonPrimitive?.long ?: 0L,
                replay = obj["replay"]?.jsonPrimitive?.contentOrNull == "true"
            )
            "error" -> Frame.ProtocolError(
                obj.str("code"),
                obj.str("message"),
                obj["channel"]?.jsonPrimitive?.contentOrNull
            )
            null -> envelope(obj)
            else -> Frame.Unknown
        }
    }.getOrDefault(Frame.Unknown)

    private fun envelope(obj: JsonObject): Frame {
        val event = obj["event"]?.jsonObject ?: return Frame.Unknown
        return Frame.Envelope(
            channel = obj.str("channel"),
            seq = obj["seq"]?.jsonPrimitive?.long ?: return Frame.Unknown,
            event = event(event),
            ts = obj["ts"]?.str()?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        )
    }

    private fun event(e: JsonObject): ServerEvent = when (val type = e.str("type")) {
        "run.status" -> ServerEvent.RunStatus(e.str("status"))
        "route.decided" -> ServerEvent.RouteDecided(
            e.str("role"),
            e["confidence"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: 0.0,
            e.str("reason")
        )
        "message.delta" -> ServerEvent.MessageDelta(e.str("messageId"), e.str("text"))
        "message.completed" -> ServerEvent.MessageCompleted(e.str("messageId"))
        "run.completed" -> ServerEvent.RunCompleted(e.str("summary"))
        "reasoning.delta" -> ServerEvent.ReasoningDelta(e.str("messageId"), e.str("text"))
        "reasoning.summary" -> ServerEvent.ReasoningSummary(e.str("messageId"), e.str("text"))
        "approval.requested" -> ServerEvent.ApprovalRequested(
            e.str("approvalId"),
            e.str("kind"),
            e.str("detail"),
            e["cwd"]?.str(),
            e["toolCallId"]?.str()
        )
        "approval.resolved" -> ServerEvent.ApprovalResolved(
            e.str("approvalId"),
            e.str("decision"),
            e["remember"]?.jsonPrimitive?.contentOrNull == "true"
        )
        "tool.started" -> ServerEvent.ToolStarted(e.str("toolCallId"), e.str("name"), e["target"]?.str())
        "tool.output" -> ServerEvent.ToolOutput(e.str("toolCallId"), e.str("chunk"), e["stream"]?.str())
        "tool.finished" -> ServerEvent.ToolFinished(
            e.str("toolCallId"),
            e.str("status"),
            e["durationMs"]?.jsonPrimitive?.long ?: 0L
        )
        "error" -> ServerEvent.Failure(
            e.str("code"),
            e.str("message"),
            e["retryable"]?.jsonPrimitive?.contentOrNull == "true"
        )
        "artifact.created" -> ServerEvent.ArtifactCreated(
            e.str("fileId"),
            e.str("name"),
            e.str("mime"),
            e["size"]?.jsonPrimitive?.long ?: 0L,
            e.str("sha256"),
            e.str("source")
        )
        "research.progress" -> ServerEvent.ResearchProgress(
            e.str("stage"),
            e["progress"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: 0.0,
            e["message"]?.str()
        )
        "research.source" -> ServerEvent.ResearchSourceFound(e.str("sourceId"), e.str("url"), e.str("title"))
        "schedule.result" -> ServerEvent.ScheduleResult(e.str("scheduleId"), e.str("status"))
        "research.completed" -> ServerEvent.ResearchCompleted(e.str("researchId"), e["runId"]?.str())
        "todo.updated" -> ServerEvent.TodoUpdated(todoPhases(e["phases"]))
        "context.used" -> ServerEvent.ContextUsed(
            e.str("runId"),
            e["engine"]?.str(),
            e["model"]?.str(),
            e["skills"]?.jsonArray?.mapNotNull { it.str() } ?: emptyList(),
            contextMemory(e["memory"]?.jsonObject),
            e["attachments"]?.jsonArray?.mapNotNull { a ->
                val o = a as? JsonObject ?: return@mapNotNull null
                ContextAttachment(o.str("fileId"), o.str("name"), o.str("mime"))
            } ?: emptyList()
        )
        else -> ServerEvent.Other(type)
    }

    private fun todoPhases(raw: JsonElement?): List<TodoPhase> = raw?.jsonArray?.mapNotNull { p ->
        val o = p as? JsonObject ?: return@mapNotNull null
        TodoPhase(
            o.str("name"),
            o["tasks"]?.jsonArray?.mapNotNull { t ->
                val task = t as? JsonObject ?: return@mapNotNull null
                TodoTask(task.str("content"), task.str("status"), task["blocker"]?.str())
            } ?: emptyList()
        )
    } ?: emptyList()

    private fun contextMemory(raw: JsonObject?): ContextMemory {
        if (raw == null) return ContextMemory(0, emptyList())
        val items = raw["items"]?.jsonArray?.mapNotNull { i ->
            val o = i as? JsonObject ?: return@mapNotNull null
            ContextMemoryItem(o.str("id"), o.str("title"))
        } ?: emptyList()
        return ContextMemory(raw["read"]?.jsonPrimitive?.int ?: 0, items)
    }

    private fun JsonObject.str(key: String): String = this[key]?.jsonPrimitive?.contentOrNull.orEmpty()

    private fun JsonElement.str(): String? = (this as? JsonPrimitive)?.contentOrNull
}
