package app.aios.android.data.api

import kotlinx.serialization.Serializable

/* Model jadwal mengikuti packages/contracts (entities.ts, api-schemas.ts). Ubah bersama kontrak. */

const val TARGET_CHAT = "chat"
const val TARGET_RESEARCH = "research"
const val TARGET_ROLE = "role"
const val DEFAULT_TIMEZONE = "Asia/Jakarta"

@Serializable
data class Schedule(
    val id: String,
    val name: String,
    val cron: String,
    val timezone: String,
    val prompt: String,
    val target: String,
    val agentRole: String? = null,
    val enabled: Boolean,
    val nextRunAt: String? = null,
    val conversationId: String? = null,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class ScheduleList(val items: List<Schedule>)

@Serializable
data class ScheduleRun(
    val id: String,
    val scheduleId: String,
    val runId: String? = null,
    /** running, succeeded, failed, missed. */
    val status: String,
    val startedAt: String,
    val finishedAt: String? = null,
)

@Serializable
data class CreateScheduleRequest(
    val name: String,
    val cron: String,
    val timezone: String,
    val prompt: String,
    val target: String,
    val agentRole: String? = null,
    val enabled: Boolean = true,
)

@Serializable
data class UpdateScheduleRequest(
    val name: String? = null,
    val prompt: String? = null,
    val enabled: Boolean? = null,
)

@Serializable
data class ScheduleParseRequest(val text: String, val timezone: String = DEFAULT_TIMEZONE)

/** Hasil baca bahasa alami; belum disimpan sampai pengguna mengonfirmasi lewat POST /schedules. */
@Serializable
data class ScheduleParse(
    val name: String,
    val cron: String,
    val timezone: String,
    val prompt: String,
    val target: String,
    val agentRole: String? = null,
    val description: String,
    val nextRuns: List<String>,
)
