package app.aios.android

import app.aios.android.data.api.ServerUrl
import app.aios.android.data.api.ServerUrlResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlTest {
    private fun valid(input: String, allowLocal: Boolean = false): String {
        val result = ServerUrl.parse(input, allowLocal)
        assertTrue("$input -> $result", result is ServerUrlResult.Valid)
        return ServerUrl.display((result as ServerUrlResult.Valid).url)
    }

    @Test
    fun `menambah https bila skema tidak ditulis`() {
        assertEquals("https://aios.contoh.com", valid("aios.contoh.com"))
        assertEquals("https://aios.contoh.com:8443", valid("  aios.contoh.com:8443  "))
    }

    @Test
    fun `membuang garis miring penutup dan mempertahankan path proxy`() {
        assertEquals("https://aios.contoh.com", valid("https://aios.contoh.com/"))
        assertEquals("https://contoh.com/aios", valid("https://contoh.com/aios/"))
    }

    @Test
    fun `kosong dan tidak valid`() {
        assertEquals(ServerUrlResult.Empty, ServerUrl.parse("   ", false))
        assertEquals(ServerUrlResult.Invalid, ServerUrl.parse("https://", false))
        assertEquals(ServerUrlResult.Invalid, ServerUrl.parse("ini bukan alamat", false))
        assertEquals(ServerUrlResult.Invalid, ServerUrl.parse("https://contoh.com/?x=1", false))
        assertEquals(ServerUrlResult.Invalid, ServerUrl.parse("https://user:pw@contoh.com", false))
    }

    @Test
    fun `http ditolak kecuali localhost pada build debug`() {
        assertEquals(ServerUrlResult.CleartextNotAllowed, ServerUrl.parse("http://aios.contoh.com", false))
        assertEquals(ServerUrlResult.CleartextNotAllowed, ServerUrl.parse("http://10.0.2.2:8080", false))
        assertEquals(ServerUrlResult.CleartextNotAllowed, ServerUrl.parse("http://192.168.1.5:8080", true))
        assertEquals("http://10.0.2.2:8080", valid("http://10.0.2.2:8080", allowLocal = true))
        assertEquals("http://localhost:8080", valid("http://localhost:8080", allowLocal = true))
    }
}
