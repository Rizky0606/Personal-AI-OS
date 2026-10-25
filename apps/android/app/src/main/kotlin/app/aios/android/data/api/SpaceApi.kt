package app.aios.android.data.api

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/* Ruang pengetahuan (A13), mengikuti packages/contracts (SpaceSchema, endpoints/spaces.ts). Ubah bersama kontrak. */

@Serializable
data class Space(
    val id: String,
    val name: String,
    val description: String = "",
    val documentCount: Int = 0,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class SpaceList(val items: List<Space>)

@Serializable
data class SpaceDocument(
    val id: String,
    val spaceId: String,
    val fileId: String,
    val name: String,
    val chars: Int,
    val chunks: Int,
    val createdAt: String
)

@Serializable
data class SpaceDocumentList(val items: List<SpaceDocument>)

@Serializable
data class CreateSpaceRequest(val name: String, val description: String = "")

@Serializable
data class AddSpaceDocumentRequest(val fileId: String)

interface SpaceApi {
    @GET("spaces")
    suspend fun list(): SpaceList

    @POST("spaces")
    suspend fun create(@Body body: CreateSpaceRequest): Space

    @DELETE("spaces/{id}")
    suspend fun delete(@Path("id") id: String): Response<Unit>

    @GET("spaces/{id}/documents")
    suspend fun documents(@Path("id") id: String): SpaceDocumentList

    @POST("spaces/{id}/documents")
    suspend fun addDocument(@Path("id") id: String, @Body body: AddSpaceDocumentRequest): SpaceDocument

    @DELETE("spaces/{id}/documents/{documentId}")
    suspend fun deleteDocument(@Path("id") id: String, @Path("documentId") documentId: String): Response<Unit>
}
