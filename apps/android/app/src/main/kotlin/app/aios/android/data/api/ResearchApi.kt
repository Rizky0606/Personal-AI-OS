package app.aios.android.data.api

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface ResearchApi {
    @GET("research")
    suspend fun list(@Query("before") before: String? = null, @Query("limit") limit: Int = PAGE_SIZE): Page<ResearchJob>

    @POST("research")
    suspend fun create(@Body body: CreateResearchRequest): ResearchJob

    @GET("research/{id}")
    suspend fun get(@Path("id") id: String): ResearchJobDetail

    @POST("research/{id}/cancel")
    suspend fun cancel(@Path("id") id: String): ResearchJob

    @Streaming
    @GET("research/{id}/export")
    suspend fun export(@Path("id") id: String, @Query("format") format: String): Response<ResponseBody>

    companion object {
        const val PAGE_SIZE = 30
    }
}
