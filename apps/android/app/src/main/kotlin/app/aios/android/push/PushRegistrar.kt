package app.aios.android.push

import app.aios.android.data.api.DevicesApi
import app.aios.android.data.api.PushTokenRequest
import kotlinx.coroutines.CancellationException

/** Sumber token FCM. Null bila Firebase tidak dikonfigurasi (tanpa google-services.json) atau token belum ada. */
interface PushTokenSource {
    val available: Boolean

    suspend fun token(): String?
}

/** Penyimpanan "perangkat|token" terakhir yang berhasil didaftarkan. Diimplementasikan SettingsStore. */
interface RegistrationStore {
    suspend fun registeredPush(): String?

    suspend fun setRegisteredPush(value: String)
}

/**
 * Menjaga token FCM perangkat ini terdaftar di server. Token baru dikirim hanya bila berbeda dari yang
 * terakhir berhasil didaftarkan; kegagalan jaringan tidak dianggap terdaftar, jadi dicoba lagi pada sinkron berikutnya.
 */
class PushRegistrar(
    private val source: PushTokenSource,
    private val api: DevicesApi,
    private val settings: RegistrationStore,
) {
    val available: Boolean get() = source.available

    /** Dipanggil saat aplikasi dibuka dalam keadaan login. */
    suspend fun sync(deviceId: String) {
        val token = source.token() ?: return
        register(deviceId, token)
    }

    /** Dipanggil saat FCM menerbitkan token baru. */
    suspend fun onNewToken(deviceId: String?, token: String) {
        if (deviceId == null) return
        register(deviceId, token)
    }

    /** Dipakai setelah login yang sudah membawa token di request login. */
    suspend fun markRegistered(deviceId: String, token: String) =
        settings.setRegisteredPush(registrationKey(deviceId, token))

    private fun registrationKey(deviceId: String, token: String) = "$deviceId|$token"

    private suspend fun register(deviceId: String, token: String) {
        // Kuncinya perangkat + token: login ulang sebagai perangkat baru dengan token yang sama tetap harus mendaftar.
        val key = registrationKey(deviceId, token)
        if (settings.registeredPush() == key) return
        try {
            val response = api.setPushToken(deviceId, PushTokenRequest(token))
            if (response.isSuccessful) settings.setRegisteredPush(key)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Jaringan mati atau server menolak: coba lagi pada sinkron berikutnya.
        }
    }
}
