package app.aios.android.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface ScheduleApi {
    @GET("schedules")
    suspend fun list(): ScheduleList

    @POST("schedules")
    suspend fun create(@Body body: CreateScheduleRequest): Schedule

    @POST("schedules/parse")
    suspend fun parse(@Body body: ScheduleParseRequest): ScheduleParse

    @PATCH("schedules/{id}")
    suspend fun update(@Path("id") id: String, @Body body: UpdateScheduleRequest): Schedule

    @DELETE("schedules/{id}")
    suspend fun delete(@Path("id") id: String): Response<Unit>

    @POST("schedules/{id}/run-now")
    suspend fun runNow(@Path("id") id: String): Run

    @GET("schedules/{id}/runs")
    suspend fun runs(
        @Path("id") id: String,
        @Query("before") before: String? = null,
        @Query("limit") limit: Int = RUNS_PAGE,
    ): Page<ScheduleRun>

    companion object {
        const val RUNS_PAGE = 30
    }
}
