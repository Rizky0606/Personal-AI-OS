package app.aios.android.data.api

import app.aios.android.data.auth.TokenRefresher
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/** Mengganti basis semu `https://aios.invalid/v1/` dengan alamat server pengguna. */
class BaseUrlInterceptor(private val endpoint: ServerEndpoint) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val base = endpoint.get() ?: throw NoServerException()
        val prefix = base.encodedPath.trimEnd('/')
        val rewritten = request.url.newBuilder()
            .scheme(base.scheme)
            .host(base.host)
            .port(base.port)
            .encodedPath(prefix + request.url.encodedPath)
            .build()
        return chain.proceed(request.newBuilder().url(rewritten).build())
    }
}

internal fun Request.withBearer(token: String): Request = newBuilder().header("Authorization", "Bearer $token").build()

/**
 * Memasang access token. Bila token hampir habis, request menunggu refresh yang sedang berjalan
 * (satu refresh untuk semua request), sehingga tidak ada request yang dikirim dengan token mati.
 */
class AuthInterceptor(private val refresher: TokenRefresher) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val token = refresher.accessTokenBlocking() ?: return chain.proceed(request)
        return chain.proceed(request.withBearer(token))
    }
}

/** Menangani 401: refresh sekali, ulangi request dengan token baru, menyerah bila tetap 401. */
class TokenAuthenticator(private val refresher: TokenRefresher) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.priorResponse != null) return null
        val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")
        val fresh = refresher.refreshAfterUnauthorizedBlocking(failedToken) ?: return null
        return response.request.withBearer(fresh)
    }
}
