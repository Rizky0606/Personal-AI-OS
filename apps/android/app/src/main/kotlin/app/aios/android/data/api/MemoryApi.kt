package app.aios.android.data.api

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

/* Memori yang terlihat (A9), mengikuti packages/contracts (MemorySchema, endpoints/memory.ts). Ubah bersama kontrak. */

/** Sama dengan MEMORY_TEXT_MAX di kontrak. */
const val MEMORY_TEXT_MAX = 500

@Serializable
data class Memory(
    val id: String,
    val text: String,
    val enabled: Boolean,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class MemoryList(val items: List<Memory>)

@Serializable
data class CreateMemoryRequest(val text: String)

@Serializable
data class UpdateMemoryRequest(val text: String? = null, val enabled: Boolean? = null)

interface MemoryApi {
    @GET("memories")
    suspend fun list(): MemoryList

    @POST("memories")
    suspend fun create(@Body body: CreateMemoryRequest): Memory

    @PATCH("memories/{id}")
    suspend fun update(@Path("id") id: String, @Body body: UpdateMemoryRequest): Memory

    @DELETE("memories/{id}")
    suspend fun delete(@Path("id") id: String): Response<Unit>
}
