package app.aios.android.data.api

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.Part
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface ChatApi {
    @GET("conversations")
    suspend fun listConversations(
        @Query("before") before: String? = null,
        @Query("limit") limit: Int = PAGE_SIZE,
        @Query("archived") archived: String? = null
    ): Page<Conversation>

    @POST("conversations")
    suspend fun createConversation(@Body body: CreateConversationRequest): Conversation

    @PATCH("conversations/{id}")
    suspend fun updateConversation(@Path("id") id: String, @Body body: UpdateConversationRequest): Conversation

    /** Server hanya mengarsipkan; tidak ada penghapusan permanen di API. */
    /** Tanpa [permanent] percakapan diarsipkan; "true" menghapusnya beserta pesannya. */
    @DELETE("conversations/{id}")
    suspend fun archiveConversation(
        @Path("id") id: String,
        @Query("permanent") permanent: String? = null
    ): Response<Unit>

    @GET("conversations/{id}/messages")
    suspend fun listMessages(
        @Path("id") id: String,
        @Query("before") before: String? = null,
        @Query("limit") limit: Int = MESSAGE_PAGE_SIZE
    ): Page<Message>

    @POST("conversations/{id}/messages")
    suspend fun sendMessage(@Path("id") id: String, @Body body: SendMessageRequest): SendMessageResponse

    /** Memotong percakapan dari pesan ini lalu mengirim teks baru; agent memulai sesi dengan riwayat sisanya. */
    @POST("messages/{id}/edit")
    suspend fun editMessage(@Path("id") messageId: String, @Body body: SendMessageRequest): SendMessageResponse

    /** Menghapus pesan ini beserta semua pesan sesudahnya. */
    @DELETE("messages/{id}")
    suspend fun deleteMessage(@Path("id") messageId: String): Response<Unit>

    /** Unggah satu lampiran (multipart, field `file`). */
    @Multipart
    @POST("files")
    suspend fun uploadFile(@Part file: MultipartBody.Part): FileRecord

    @GET("runs/{id}")
    suspend fun getRun(@Path("id") id: String): Run

    @POST("runs/{id}/cancel")
    suspend fun cancelRun(@Path("id") id: String): Run

    @GET("models")
    suspend fun listModels(): ModelList

    @GET("roles")
    suspend fun listRoles(): RoleList

    /** Isi berkas (lampiran atau berkas buatan agent) untuk disimpan pemilik. */
    @Streaming
    @GET("files/{id}/download")
    suspend fun downloadFile(@Path("id") id: String): ResponseBody

    @GET("search")
    suspend fun search(@Query("q") q: String, @Query("limit") limit: Int = SEARCH_LIMIT): SearchResponse

    companion object {
        const val PAGE_SIZE = 50
        const val MESSAGE_PAGE_SIZE = 50
    }
}

const val SEARCH_LIMIT = 20
