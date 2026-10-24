package app.aios.android.data.auth

import app.aios.android.data.api.ApiError
import app.aios.android.data.api.DEVICE_KIND_ANDROID
import app.aios.android.data.api.DeviceInfo
import app.aios.android.data.api.LoginRequest
import app.aios.android.data.api.PublicAuthApi
import app.aios.android.data.api.ServerEndpoint
import app.aios.android.data.api.ServerUrl
import app.aios.android.data.api.ServerUrlResult
import app.aios.android.data.api.SessionApi
import app.aios.android.data.api.toApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow

sealed interface LoginOutcome {
    data object Success : LoginOutcome

    /** Alamat server tidak lolos validasi sebelum request dikirim. */
    data class BadServer(val reason: ServerUrlResult) : LoginOutcome

    data class Failure(val error: ApiError) : LoginOutcome
}

class AuthRepository(
    private val store: TokenStore,
    private val publicApi: PublicAuthApi,
    private val sessionApi: SessionApi,
    private val endpoint: ServerEndpoint,
    private val events: SessionEvents,
    private val deviceName: String,
    private val allowCleartextLocal: Boolean,
    private val isConnected: () -> Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Menghapus data milik pengguna di perangkat (cache chat) saat sesi berganti atau berakhir. */
    private val resetUserData: suspend () -> Unit = {},
    /** Token FCM perangkat ini (null bila push tidak tersedia); ikut dikirim saat login. */
    private val pushToken: suspend () -> String? = { null },
    /** Dipanggil setelah login sukses yang membawa token, agar tidak didaftarkan dua kali. */
    private val onPushRegistered: suspend (deviceId: String, token: String) -> Unit = { _, _ -> },
    /** Alamat gateway tertanam saat build; null berarti alamat diketik di layar login. */
    val fixedServerUrl: String? = null
) {
    val session: Flow<StoredSession?> = store.session
    val lastServerUrl: Flow<String?> = store.lastServerUrl

    suspend fun login(serverInput: String, password: String, totp: String): LoginOutcome {
        val parsed = ServerUrl.parse(serverInput, allowCleartextLocal)
        val url = (parsed as? ServerUrlResult.Valid)?.url ?: return LoginOutcome.BadServer(parsed)
        endpoint.set(url)
        return try {
            val token = runCatching { pushToken() }.getOrNull()
            val response = publicApi.login(
                LoginRequest(
                    password = password,
                    totp = totp,
                    device = DeviceInfo(name = deviceName, kind = DEVICE_KIND_ANDROID),
                    pushToken = token
                )
            )
            resetUserData()
            store.save(
                StoredSession(
                    serverUrl = ServerUrl.display(url),
                    accessToken = response.accessToken,
                    refreshToken = response.refreshToken,
                    accessExpiresAtMs = clock() + response.expiresIn * MILLIS_PER_SECOND,
                    deviceId = response.device.id,
                    deviceName = response.device.name
                )
            )
            events.reset()
            if (token != null) onPushRegistered(response.device.id, token)
            LoginOutcome.Success
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            LoginOutcome.Failure(e.toApiError(connected = isConnected()))
        }
    }

    /** Mencabut token di server bila bisa, tetapi selalu menghapus sesi lokal agar logout tidak pernah macet. */
    suspend fun logout() {
        try {
            sessionApi.logout()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Server tidak terjangkau atau token sudah mati: sesi lokal tetap dihapus.
        }
        store.clear()
        runCatching { resetUserData() }
        events.reset()
    }

    private companion object {
        const val MILLIS_PER_SECOND = 1000L
    }
}
