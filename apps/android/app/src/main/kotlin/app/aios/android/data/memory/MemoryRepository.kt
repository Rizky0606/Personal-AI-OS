package app.aios.android.data.memory

import app.aios.android.data.api.CreateMemoryRequest
import app.aios.android.data.api.Memory
import app.aios.android.data.api.MemoryApi
import app.aios.android.data.api.UpdateMemoryRequest
import retrofit2.HttpException

/** Memori selalu dibaca dari server (tanpa cache): yang disuntik ke agent adalah isi server. */
interface MemoryRepository {
    suspend fun list(): List<Memory>

    suspend fun create(text: String): Memory

    suspend fun update(id: String, text: String? = null, enabled: Boolean? = null): Memory

    suspend fun delete(id: String)
}

class RemoteMemoryRepository(private val api: MemoryApi) : MemoryRepository {
    override suspend fun list() = api.list().items

    override suspend fun create(text: String) = api.create(CreateMemoryRequest(text.trim()))

    override suspend fun update(id: String, text: String?, enabled: Boolean?) =
        api.update(id, UpdateMemoryRequest(text?.trim(), enabled))

    override suspend fun delete(id: String) {
        val response = api.delete(id)
        if (!response.isSuccessful) throw HttpException(response)
    }
}
