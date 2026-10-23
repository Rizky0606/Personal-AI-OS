package app.aios.android.data.api

import app.aios.android.R
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Kegagalan API yang sudah dipetakan ke pesan tampilan (resource) dan jenis penanganan. */
data class ApiError(
    val kind: Kind,
    val messageRes: Int,
    /** Nilai `code` dari Problem bila ada, untuk keputusan di lapisan atas. */
    val code: String? = null,
    val fieldErrors: List<ProblemFieldError> = emptyList()
) {
    enum class Kind {
        Offline,
        Timeout,
        Unreachable,
        Tls,
        Unauthorized,
        RateLimited,
        Forbidden,
        NotFound,
        Validation,
        Server,
        Unknown
    }
}

private val problemJson = Json { ignoreUnknownKeys = true }

/** Memetakan exception Retrofit/OkHttp. `connected` membedakan "tidak ada internet" dari "server tidak terjangkau". */
fun Throwable.toApiError(connected: Boolean = true): ApiError = when (this) {
    is HttpException -> httpError(this)
    is SocketTimeoutException -> ApiError(ApiError.Kind.Timeout, R.string.error_timeout)
    is SSLException -> ApiError(ApiError.Kind.Tls, R.string.error_tls)
    is UnknownHostException, is ConnectException, is NoServerException, is IOException -> networkError(connected)
    else -> ApiError(ApiError.Kind.Unknown, R.string.error_unknown)
}

private fun networkError(connected: Boolean): ApiError = if (connected) {
    ApiError(ApiError.Kind.Unreachable, R.string.error_unreachable)
} else {
    ApiError(ApiError.Kind.Offline, R.string.error_offline)
}

private fun httpError(e: HttpException): ApiError {
    val problem = runCatching {
        e.response()?.errorBody()?.string()?.let { problemJson.decodeFromString(Problem.serializer(), it) }
    }.getOrNull()
    val code = problem?.code
    val fields = problem?.errors.orEmpty()
    return when (e.code()) {
        400 -> ApiError(ApiError.Kind.Validation, R.string.error_unknown, code, fields)
        401 -> {
            val message = if (code == "invalid_credentials") {
                R.string.error_invalid_credentials
            } else {
                R.string.error_session_expired
            }
            ApiError(ApiError.Kind.Unauthorized, message, code)
        }
        403 -> ApiError(ApiError.Kind.Forbidden, R.string.error_forbidden, code)
        404 -> ApiError(ApiError.Kind.NotFound, R.string.error_not_found, code)
        429 -> ApiError(ApiError.Kind.RateLimited, R.string.error_rate_limited, code)
        in 500..599 -> ApiError(ApiError.Kind.Server, R.string.error_server, code)
        else -> ApiError(ApiError.Kind.Unknown, R.string.error_unknown, code)
    }
}
