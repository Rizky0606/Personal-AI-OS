package app.aios.android.data.auth

import app.aios.android.data.api.TokenPair
import kotlinx.coroutines.flow.Flow

data class StoredSession(
    val serverUrl: String,
    val accessToken: String,
    val refreshToken: String,
    /** Waktu access token habis (epoch ms). */
    val accessExpiresAtMs: Long,
    val deviceId: String,
    val deviceName: String
)

/** Penyimpanan sesi. Implementasi produksi mengenkripsi token; tes memakai versi memori. */
interface TokenStore {
    /** Sesi aktif, atau null bila belum login atau data tidak terbaca. */
    val session: Flow<StoredSession?>

    /** Alamat server terakhir yang berhasil dipakai login; tetap ada setelah logout. */
    val lastServerUrl: Flow<String?>

    suspend fun current(): StoredSession?

    suspend fun lastServerUrlOnce(): String?

    suspend fun save(session: StoredSession)

    /** Mengganti pasangan token hasil refresh; no-op bila tidak ada sesi. */
    suspend fun updateTokens(tokens: TokenPair, nowMs: Long)

    /** Menghapus token dan data perangkat, mempertahankan alamat server terakhir. */
    suspend fun clear()
}
