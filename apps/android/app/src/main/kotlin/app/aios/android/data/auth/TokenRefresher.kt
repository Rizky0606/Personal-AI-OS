package app.aios.android.data.auth

import app.aios.android.data.api.PublicAuthApi
import app.aios.android.data.api.RefreshRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException
import java.io.IOException

/** Sinyal bahwa sesi berakhir di tengah pemakaian (refresh token ditolak), untuk pesan di layar login. */
class SessionEvents {
    private val expiredFlow = MutableStateFlow(false)
    val expired: StateFlow<Boolean> = expiredFlow

    fun markExpired() {
        expiredFlow.value = true
    }

    fun reset() {
        expiredFlow.value = false
    }
}

/**
 * Satu-satunya tempat refresh token dipakai. Refresh token dirotasi server (pemakaian ulang dianggap
 * pencurian), jadi dua refresh bersamaan tidak boleh terjadi: semua request mengantre di mutex yang
 * sama, dan yang datang belakangan memakai token hasil refresh yang pertama.
 */
class TokenRefresher(
    private val store: TokenStore,
    private val api: PublicAuthApi,
    private val events: SessionEvents,
    private val clock: () -> Long = System::currentTimeMillis
) {
    private val mutex = Mutex()

    fun accessTokenBlocking(): String? = runBlocking { validAccessToken() }

    fun refreshAfterUnauthorizedBlocking(failedToken: String?): String? =
        runBlocking { refreshAfterUnauthorized(failedToken) }

    /** Token yang masih berlaku; me-refresh dulu bila sisa waktunya di bawah [SKEW_MS]. */
    suspend fun validAccessToken(): String? = mutex.withLock {
        val session = store.current() ?: return@withLock null
        if (session.accessExpiresAtMs - clock() > SKEW_MS) session.accessToken else refresh(session)
    }

    /** Dipanggil saat server menjawab 401 untuk [failedToken]. */
    suspend fun refreshAfterUnauthorized(failedToken: String?): String? = mutex.withLock {
        val session = store.current() ?: return@withLock null
        // Request lain sudah me-refresh saat kita mengantre: pakai token barunya.
        if (session.accessToken != failedToken) session.accessToken else refresh(session)
    }

    private suspend fun refresh(session: StoredSession): String? = try {
        val tokens = api.refresh(RefreshRequest(session.refreshToken))
        store.updateTokens(tokens, clock())
        tokens.accessToken
    } catch (e: HttpException) {
        if (e.code() == HTTP_BAD_REQUEST || e.code() == HTTP_UNAUTHORIZED) {
            // Refresh token ditolak (kedaluwarsa, dicabut, atau terdeteksi dipakai ulang): sesi selesai.
            store.clear()
            events.markExpired()
            null
        } else {
            throw IOException("Refresh token gagal (HTTP ${e.code()})", e)
        }
    }

    companion object {
        const val SKEW_MS = 30_000L
        private const val HTTP_BAD_REQUEST = 400
        private const val HTTP_UNAUTHORIZED = 401
    }
}
