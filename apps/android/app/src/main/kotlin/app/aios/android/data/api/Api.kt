package app.aios.android.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Path

/** Endpoint tanpa token: dipanggil lewat klien yang tidak memasang Authorization. */
interface PublicAuthApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): TokenPair
}

@kotlinx.serialization.Serializable
data class PushTokenRequest(val pushToken: String)

/** Perangkat: token FCM disimpan di server supaya hasil riset dan jadwal bisa dikirim sebagai notifikasi. */
interface DevicesApi {
    @POST("devices/{id}/push-token")
    suspend fun setPushToken(@Path("id") id: String, @Body body: PushTokenRequest): Response<Unit>
}

/** Endpoint yang butuh access token; refresh otomatis ditangani klien OkHttp. */
interface SessionApi {
    @POST("auth/logout")
    suspend fun logout(): Response<Unit>
}
