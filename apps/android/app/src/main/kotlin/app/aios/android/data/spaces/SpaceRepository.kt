package app.aios.android.data.spaces

import app.aios.android.data.api.AddSpaceDocumentRequest
import app.aios.android.data.api.CreateSpaceRequest
import app.aios.android.data.api.Space
import app.aios.android.data.api.SpaceApi
import app.aios.android.data.api.SpaceDocument
import retrofit2.HttpException
import retrofit2.Response

/** Ruang selalu dibaca dari server (tanpa cache): indeks dokumennya ada di server. */
interface SpaceRepository {
    suspend fun list(): List<Space>

    suspend fun create(name: String, description: String = ""): Space

    suspend fun delete(id: String)

    suspend fun documents(spaceId: String): List<SpaceDocument>

    /** Menambah berkas yang sudah diunggah (POST /files) ke ruang; server mengekstrak dan mengindeks teksnya. */
    suspend fun addDocument(spaceId: String, fileId: String): SpaceDocument

    suspend fun deleteDocument(spaceId: String, documentId: String)
}

private fun Response<Unit>.orThrow() {
    if (!isSuccessful) throw HttpException(this)
}

class RemoteSpaceRepository(private val api: SpaceApi) : SpaceRepository {
    override suspend fun list() = api.list().items

    override suspend fun create(name: String, description: String) =
        api.create(CreateSpaceRequest(name.trim(), description.trim()))

    override suspend fun delete(id: String) = api.delete(id).orThrow()

    override suspend fun documents(spaceId: String) = api.documents(spaceId).items

    override suspend fun addDocument(spaceId: String, fileId: String) =
        api.addDocument(spaceId, AddSpaceDocumentRequest(fileId))

    override suspend fun deleteDocument(spaceId: String, documentId: String) =
        api.deleteDocument(spaceId, documentId).orThrow()
}
