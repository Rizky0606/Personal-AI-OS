package app.aios.android.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/*
 * Skill (P10), mengikuti packages/contracts (SkillSummarySchema, endpoints/catalog.ts). Ubah bersama kontrak.
 * Android hanya menampilkan daftar dan mengaktifkan/menonaktifkan; membuat, mengubah, memasang, dan impor
 * dilakukan dari aplikasi Windows. Nilai enum dibaca sebagai teks supaya nilai baru dari server tidak merusak daftar.
 */

const val SKILL_STATUS_ACTIVE = "active"
const val SKILL_STATUS_DISABLED = "disabled"
const val SKILL_STATUS_ARCHIVED = "archived"

@Serializable
data class SkillSummary(
    val id: String,
    val name: String,
    val description: String,
    val version: String,
    /** builtin | user | installed | agent */
    val source: String,
    val checksum: String,
    /** official | trusted | community; absen pada data lama. */
    val trust: String? = null,
    /** active | disabled | archived; absen = aktif (skill bawaan lama). */
    val status: String? = null,
    val engines: List<String>? = null,
    val pinned: Boolean? = null,
    val editable: Boolean? = null,
    val origin: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null
) {
    val isActive: Boolean get() = (status ?: SKILL_STATUS_ACTIVE) == SKILL_STATUS_ACTIVE
}

@Serializable
data class SkillList(val items: List<SkillSummary>)

@Serializable
data class SetSkillStatusRequest(val status: String)

interface SkillApi {
    /** `include=all`: juga skill nonaktif dan diarsipkan (hanya scope aplikasi). */
    @GET("skills")
    suspend fun list(@Query("include") include: String = "all"): SkillList

    /** Jawabannya hasil simpan lengkap (isi, pemindai, sinkron); yang dibaca hanya bagian indeksnya. */
    @POST("skills/{id}/status")
    suspend fun setStatus(@Path("id") id: String, @Body body: SetSkillStatusRequest): SkillSummary
}
