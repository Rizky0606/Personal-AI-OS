package app.aios.android.data.skills

import app.aios.android.data.api.SKILL_STATUS_ACTIVE
import app.aios.android.data.api.SKILL_STATUS_DISABLED
import app.aios.android.data.api.SetSkillStatusRequest
import app.aios.android.data.api.SkillApi
import app.aios.android.data.api.SkillSummary

/** Skill selalu dibaca dari server (tanpa cache): yang dipakai agent adalah katalog server. */
interface SkillRepository {
    suspend fun list(): List<SkillSummary>

    /** Aktifkan atau nonaktifkan; mengembalikan skill dengan status dari server. */
    suspend fun setActive(id: String, active: Boolean): SkillSummary
}

class RemoteSkillRepository(private val api: SkillApi) : SkillRepository {
    override suspend fun list() = api.list().items

    override suspend fun setActive(id: String, active: Boolean) = api.setStatus(
        id,
        SetSkillStatusRequest(if (active) SKILL_STATUS_ACTIVE else SKILL_STATUS_DISABLED)
    )
}
