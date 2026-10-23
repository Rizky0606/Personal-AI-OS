package app.aios.android.data.api

import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference

sealed interface ServerUrlResult {
    data class Valid(val url: HttpUrl) : ServerUrlResult
    data object Empty : ServerUrlResult
    data object Invalid : ServerUrlResult
    data object CleartextNotAllowed : ServerUrlResult
}

/** Menormalkan alamat yang diketik pengguna menjadi basis API (tanpa `/v1`). */
object ServerUrl {
    private val cleartextHosts = setOf("localhost", "10.0.2.2", "127.0.0.1")

    fun parse(input: String, allowCleartextLocal: Boolean): ServerUrlResult {
        val text = input.trim()
        if (text.isEmpty()) return ServerUrlResult.Empty
        val withScheme = if (text.contains("://")) text else "https://$text"
        val url = withScheme.toHttpUrlOrNull() ?: return ServerUrlResult.Invalid
        if (url.query != null || url.fragment != null || url.username.isNotEmpty()) {
            return ServerUrlResult.Invalid
        }
        if (!url.isHttps && !(allowCleartextLocal && url.host in cleartextHosts)) {
            return ServerUrlResult.CleartextNotAllowed
        }
        return ServerUrlResult.Valid(url)
    }

    /** Bentuk yang disimpan dan ditampilkan: tanpa `/` penutup. */
    fun display(url: HttpUrl): String = url.toString().trimEnd('/')
}

/** Tidak ada alamat server tersimpan; diperlakukan sebagai kegagalan jaringan, bukan crash. */
class NoServerException : IOException("Alamat server belum diisi")

/** Alamat server aktif. Retrofit dibangun dengan basis semu; BaseUrlInterceptor menggantinya per request. */
class ServerEndpoint(private val load: suspend () -> String?) {
    private val current = AtomicReference<HttpUrl?>(null)

    fun set(url: HttpUrl) = current.set(url)

    fun clear() = current.set(null)

    /** Dipanggil dari thread OkHttp, jadi aman memblokir saat pertama kali membaca penyimpanan. */
    fun get(): HttpUrl? {
        current.get()?.let { return it }
        val stored = runBlocking { load() }?.toHttpUrlOrNull() ?: return null
        current.set(stored)
        return stored
    }
}
