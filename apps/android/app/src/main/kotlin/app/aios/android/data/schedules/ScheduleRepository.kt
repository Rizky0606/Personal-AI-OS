package app.aios.android.data.schedules

import app.aios.android.data.api.CreateScheduleRequest
import app.aios.android.data.api.Page
import app.aios.android.data.api.Run
import app.aios.android.data.api.Schedule
import app.aios.android.data.api.ScheduleApi
import app.aios.android.data.api.ScheduleParse
import app.aios.android.data.api.ScheduleParseRequest
import app.aios.android.data.api.ScheduleRun
import app.aios.android.data.api.UpdateScheduleRequest
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** Jadwal selalu dibaca dari server (tanpa cache): hasil dan waktu jalan berikutnya harus segar. */
interface ScheduleRepository {
    suspend fun list(): List<Schedule>

    suspend fun parse(text: String, timezone: String): ScheduleParse

    suspend fun create(draft: ScheduleParse, name: String, prompt: String, notify: String = draft.notify): Schedule

    suspend fun update(id: String, name: String?, prompt: String?, enabled: Boolean?, notify: String? = null): Schedule

    suspend fun delete(id: String)

    suspend fun runNow(id: String): Run

    suspend fun runs(id: String, before: String? = null): Page<ScheduleRun>

    /** Run terakhir tiap jadwal (satu panggilan per jadwal, paralel); gagal satu tidak menggagalkan yang lain. */
    suspend fun lastRuns(schedules: List<Schedule>): Map<String, ScheduleRun>
}

class RemoteScheduleRepository(private val api: ScheduleApi) : ScheduleRepository {
    override suspend fun list() = api.list().items

    override suspend fun parse(text: String, timezone: String) = api.parse(ScheduleParseRequest(text.trim(), timezone))

    override suspend fun create(draft: ScheduleParse, name: String, prompt: String, notify: String) = api.create(
        CreateScheduleRequest(
            name = name.trim(),
            cron = draft.cron,
            timezone = draft.timezone,
            prompt = prompt.trim(),
            target = draft.target,
            agentRole = draft.agentRole,
            notify = notify
        )
    )

    override suspend fun update(id: String, name: String?, prompt: String?, enabled: Boolean?, notify: String?) =
        api.update(id, UpdateScheduleRequest(name?.trim(), prompt?.trim(), enabled, notify))

    override suspend fun delete(id: String) {
        api.delete(id)
    }

    override suspend fun runNow(id: String) = api.runNow(id)

    override suspend fun runs(id: String, before: String?) = api.runs(id, before)

    override suspend fun lastRuns(schedules: List<Schedule>): Map<String, ScheduleRun> = coroutineScope {
        schedules.map { s ->
            async {
                runCatching { api.runs(s.id, limit = 1).items.firstOrNull() }.getOrNull()?.let { s.id to it }
            }
        }.mapNotNull { it.await() }.toMap()
    }
}
