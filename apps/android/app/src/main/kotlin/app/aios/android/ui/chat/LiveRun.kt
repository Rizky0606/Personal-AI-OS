@file:Suppress("MaxLineLength")

package app.aios.android.ui.chat

import app.aios.android.data.api.RunError
import app.aios.android.data.api.TERMINAL_RUN_STATUSES
import app.aios.android.data.realtime.ServerEvent

data class Artifact(
    val fileId: String,
    val name: String,
    val mime: String,
    val size: Long,
    val sha256: String,
    val source: String
) {
    val inline: Boolean get() = mime.lowercase() in setOf("image/png", "image/jpeg", "image/webp", "image/gif")
}
data class ToolStep(
    val id: String,
    val name: String,
    val target: String?,
    /** running, ok, error, denied, cancelled. */
    val status: String,
    val durationMs: Long?
)

/** Keadaan satu run yang sedang (atau baru saja) mengalir lewat WebSocket. Murni, tanpa Android. */
data class LiveRun(
    val runId: String,
    val role: String? = null,
    val status: String = "queued",
    /** ID pesan asisten, diketahui dari delta pertama. */
    val messageId: String? = null,
    val text: String = "",
    val reasoning: String = "",
    val tools: List<ToolStep> = emptyList(),
    val artifacts: List<Artifact> = emptyList(),
    val error: RunError? = null
) {
    val finished: Boolean get() = status in TERMINAL_RUN_STATUSES

    fun reduce(event: ServerEvent): LiveRun = when (event) {
        is ServerEvent.RunStatus -> copy(status = event.status)
        is ServerEvent.Failure -> copy(error = RunError(event.code, event.message, event.retryable))
        is ServerEvent.RouteDecided -> copy(role = event.role)
        is ServerEvent.MessageDelta -> copy(messageId = event.messageId, text = text + event.text)
        is ServerEvent.ReasoningDelta -> copy(
            messageId = messageId ?: event.messageId,
            reasoning = reasoning + event.text
        )
        is ServerEvent.ToolStarted -> copy(
            tools = tools.filterNot { it.id == event.toolCallId } +
                ToolStep(event.toolCallId, event.name, event.target, "running", null)
        )
        is ServerEvent.ToolFinished -> copy(
            tools = tools.map {
                if (it.id == event.toolCallId) it.copy(status = event.status, durationMs = event.durationMs) else it
            }
        )
        is ServerEvent.ArtifactCreated -> copy(
            artifacts = artifacts.filterNot { it.fileId == event.fileId } +
                Artifact(event.fileId, event.name, event.mime, event.size, event.sha256, event.source)
        )
        is ServerEvent.MessageCompleted,
        is ServerEvent.ReasoningSummary,
        is ServerEvent.ApprovalRequested,
        is ServerEvent.ApprovalResolved,
        is ServerEvent.RunCompleted,
        is ServerEvent.ResearchProgress,
        is ServerEvent.ResearchSourceFound,
        is ServerEvent.ResearchCompleted,
        is ServerEvent.ScheduleResult,
        is ServerEvent.Other -> this
    }
}
