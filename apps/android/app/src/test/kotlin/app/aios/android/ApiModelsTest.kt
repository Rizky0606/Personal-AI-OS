package app.aios.android

import app.aios.android.data.api.DEVICE_KIND_ANDROID
import app.aios.android.data.api.DeviceInfo
import app.aios.android.data.api.LoginRequest
import app.aios.android.data.api.LoginResponse
import app.aios.android.data.api.Problem
import app.aios.android.data.api.RefreshRequest
import app.aios.android.data.api.TokenPair
import app.aios.android.data.api.toApiError
import app.aios.android.data.api.ApiError
import app.aios.ui.tokens.Tokens
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

/** Bentuk JSON mengikuti contoh nyata dari gateway (packages/contracts). */
class ApiModelsTest {
    @Test
    fun `request login tidak memuat pushToken bila kosong`() {
        val json = testJson.encodeToString(
            LoginRequest("pw", "123456", DeviceInfo("Pixel 8", DEVICE_KIND_ANDROID))
        )
        assertEquals("""{"password":"pw","totp":"123456","device":{"name":"Pixel 8","kind":"android"}}""", json)
    }

    @Test
    fun `request refresh`() {
        assertEquals("""{"refreshToken":"r"}""", testJson.encodeToString(RefreshRequest("r")))
    }

    @Test
    fun `respons login dengan field tambahan dari gateway tetap terbaca`() {
        val body = """
            {"accessToken":"a","refreshToken":"r","expiresIn":900,"fieldBaruDariServer":true,
             "device":{"id":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f","kind":"android","name":"HP",
                       "scopes":["app","llm"],"lastSeenAt":null,"createdAt":"2026-10-22T06:00:00.000Z"}}
        """.trimIndent()
        val response = testJson.decodeFromString<LoginResponse>(body)
        assertEquals(TokenPair("a", "r", 900), response.tokens)
        assertEquals(listOf("app", "llm"), response.device.scopes)
    }

    @Test
    fun `problem RFC 9457 dengan daftar error field`() {
        val body = """
            {"type":"urn:aios:problem:validation_failed","title":"Permintaan tidak valid","status":400,
             "detail":"TOTP 6 digit","code":"validation_failed",
             "errors":[{"path":"totp","message":"TOTP 6 digit"}]}
        """.trimIndent()
        val problem = testJson.decodeFromString<Problem>(body)
        assertEquals("validation_failed", problem.code)
        assertEquals("totp", problem.errors?.single()?.path)
    }

    private fun http(status: Int, code: String) = HttpException(
        Response.error<Unit>(
            status,
            problemJson(status, code).toResponseBody("application/problem+json".toMediaType())
        )
    )

    @Test
    fun `pemetaan status HTTP ke jenis error dan pesan`() {
        val cases = listOf(
            Triple(401, "invalid_credentials", R.string.error_invalid_credentials),
            Triple(401, "token_expired", R.string.error_session_expired),
            Triple(403, "insufficient_scope", R.string.error_forbidden),
            Triple(404, "not_found", R.string.error_not_found),
            Triple(429, "rate_limited", R.string.error_rate_limited),
            Triple(503, "service_unavailable", R.string.error_server)
        )
        cases.forEach { (status, code, message) ->
            val error = http(status, code).toApiError()
            assertEquals("$status $code", message, error.messageRes)
            assertEquals(code, error.code)
        }
    }

    @Test
    fun `kegagalan jaringan`() {
        assertEquals(ApiError.Kind.Timeout, SocketTimeoutException().toApiError().kind)
        assertEquals(ApiError.Kind.Tls, SSLHandshakeException("x").toApiError().kind)
        assertEquals(ApiError.Kind.Unreachable, UnknownHostException().toApiError(connected = true).kind)
        assertEquals(ApiError.Kind.Offline, IOException().toApiError(connected = false).kind)
        assertEquals(ApiError.Kind.Unknown, IllegalStateException().toApiError().kind)
    }

    @Test
    fun `warna window sebelum Compose sama dengan token bg`() {
        fun argb(c: Color) = "#%08X".format(c.toArgb())
        fun xml(path: String) = File(path).readText().let { Regex("""#[0-9A-Fa-f]{8}""").find(it)!!.value.uppercase() }

        assertEquals(argb(Tokens.lightColors.bg), xml("src/main/res/values/colors.xml"))
        assertEquals(argb(Tokens.darkColors.bg), xml("src/main/res/values-night/colors.xml"))
        assertTrue(Tokens.touchTarget.value >= 48f)
    }
}
