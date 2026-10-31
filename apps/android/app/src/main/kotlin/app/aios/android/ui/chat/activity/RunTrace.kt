@file:Suppress("MaxLineLength")

package app.aios.android.ui.chat.activity

import app.aios.android.data.api.TERMINAL_RUN_STATUSES
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.ui.chat.Artifact

/** Aktivitas terbaru, untuk membedakan menalar, menulis, dan memutuskan langkah berikutnya. */
enum class LastActivity { Reasoning, Text, Tool }

data class TraceTool(
    val id: String,
    /** Kosong bila tool.finished tiba sebelum tool.started (event tidak berurutan); dilengkapi saat started datang. */
    val name: String,
    val target: String?,
    /** running, ok, error, denied, cancelled. */
    val status: String,
    val durationMs: Long?,
    /** Waktu event mulai (ms epoch, dari envelope); null bila tidak diketahui. */
    val startedAt: Long?
)

/**
 * Jejak waktu dan langkah satu run untuk baris aktivitas; hidup di samping `LiveRun` (yang menyimpan teks), tidak
 * menggantikannya. Setara `LiveRun` desktop untuk bagian yang dibaca `buildActivity`. Murni, tanpa Android.
 */
data class RunTrace(
    val status: String = "queued",
    val tools: List<TraceTool> = emptyList(),
    val artifacts: List<Artifact> = emptyList(),
    /** ID permintaan izin yang belum diputuskan. */
    val approvals: List<String> = emptyList(),
    val reasoning: String = "",
    val reasoningSummary: String? = null,
    val lastActivity: LastActivity? = null,
    /** Waktu event pertama yang terlihat atau waktu run dibuat di server, yang lebih awal (ms epoch). */
    val startedAt: Long? = null,
    /** Waktu aktivitas berakhir: run.completed, error, atau status selesai pertama. Elapsed berhenti di sini. */
    val endedAt: Long? = null,
    val lastEventAt: Long? = null
) {
    /** Tidak ada lagi aktivitas yang ditunggu dari mesin: status final atau `needs_review`. */
    val settled: Boolean get() = isSettledStatus(status)

    /** Memajukan waktu mulai ke waktu run dibuat di server bila lebih awal (reload di tengah run). */
    fun withRunStart(createdAt: Long): RunTrace =
        if (startedAt != null && startedAt <= createdAt) this else copy(startedAt = createdAt)

    /** Menerapkan satu event; [ts] (ms epoch, dari envelope) mengisi waktu mulai/selesai dan waktu tiap tool. */
    fun reduce(event: ServerEvent, ts: Long? = null): RunTrace {
        val next = reduceEvent(event, ts)
        if (ts == null) return next
        val stamped = next.copy(
            startedAt = next.startedAt?.let { minOf(it, ts) } ?: ts,
            lastEventAt = next.lastEventAt?.let { maxOf(it, ts) } ?: ts
        )
        val ends = event is ServerEvent.RunCompleted ||
            event is ServerEvent.Failure ||
            (event is ServerEvent.RunStatus && isSettledStatus(event.status))
        return if (ends && stamped.endedAt == null) stamped.copy(endedAt = ts) else stamped
    }

    private fun reduceEvent(event: ServerEvent, at: Long?): RunTrace = when (event) {
        is ServerEvent.RunStatus -> copy(status = event.status)
        is ServerEvent.MessageDelta -> copy(lastActivity = LastActivity.Text)
        is ServerEvent.ReasoningDelta -> copy(reasoning = reasoning + event.text, lastActivity = LastActivity.Reasoning)
        is ServerEvent.ReasoningSummary -> copy(reasoningSummary = event.text)
        is ServerEvent.ToolStarted -> copy(lastActivity = LastActivity.Tool, tools = startTool(event, at))
        is ServerEvent.ToolFinished -> copy(lastActivity = LastActivity.Tool, tools = finishTool(event))
        is ServerEvent.ApprovalRequested -> copy(
            approvals = approvals.filterNot { it == event.approvalId } + event.approvalId
        )
        is ServerEvent.ArtifactCreated -> copy(
            artifacts = artifacts.filterNot {
                it.fileId == event.fileId
            } + Artifact(event.fileId, event.name, event.mime, event.size, event.sha256, event.source)
        )
        else -> this
    }

    private fun startTool(event: ServerEvent.ToolStarted, at: Long?): List<TraceTool> {
        if (tools.none { it.id == event.toolCallId }) {
            return tools + TraceTool(event.toolCallId, event.name, event.target, "running", null, at)
        }
        // Diputar ulang atau melengkapi tool.finished yang datang lebih dulu: posisi dan status akhir dipertahankan.
        return tools.map {
            if (it.id == event.toolCallId) {
                it.copy(name = event.name, target = event.target ?: it.target, startedAt = it.startedAt ?: at)
            } else {
                it
            }
        }
    }

    private fun finishTool(event: ServerEvent.ToolFinished): List<TraceTool> {
        if (tools.none { it.id == event.toolCallId }) {
            return tools + TraceTool(event.toolCallId, "", null, event.status, event.durationMs, null)
        }
        return tools.map {
            if (it.id == event.toolCallId) it.copy(status = event.status, durationMs = event.durationMs) else it
        }
    }
}

internal fun isSettledStatus(status: String): Boolean = status in TERMINAL_RUN_STATUSES || status == "needs_review"
