package app.aios.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Interceptor auth dan refresh token terhadap server HTTP sungguhan (MockWebServer). */
class AuthFlowTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun http(store: FakeTokenStore, clock: () -> Long = { NOW_MS }) = TestHttp(server, store, clock)

    private fun RecordedRequest.bearer() = getHeader("Authorization")

    @Test
    fun `memasang bearer dan mengirim ke alamat server dengan prefix v1`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(204))
        val h = http(FakeTokenStore(session(server.url("/").toString().trimEnd('/'))))

        assertEquals(204, h.sessionApi.logout().code())

        val request = server.takeRequest()
        assertEquals("/v1/auth/logout", request.path)
        assertEquals("Bearer access-1", request.bearer())
    }

    @Test
    fun `tanpa sesi request dikirim tanpa Authorization`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "missing_token")))
        val h = http(FakeTokenStore(null))

        assertEquals(401, h.sessionApi.logout().code())
        assertNull(server.takeRequest().bearer())
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `401 memicu satu refresh lalu mengulang request dengan token baru`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "token_expired")))
        server.enqueue(MockResponse().setBody(tokenJson("access-2", "refresh-2")))
        server.enqueue(MockResponse().setResponseCode(204))
        val store = FakeTokenStore(session("x"))
        val h = http(store)

        assertEquals(204, h.sessionApi.logout().code())

        val first = server.takeRequest()
        val refresh = server.takeRequest()
        val retry = server.takeRequest()
        assertEquals("Bearer access-1", first.bearer())
        assertEquals("/v1/auth/refresh", refresh.path)
        assertTrue(refresh.body.readUtf8().contains("refresh-1"))
        assertNull(refresh.bearer())
        assertEquals("Bearer access-2", retry.bearer())
        assertEquals("refresh-2", store.current()?.refreshToken)
    }

    @Test
    fun `401 berulang setelah refresh tidak berputar tanpa akhir`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "token_expired")))
        server.enqueue(MockResponse().setBody(tokenJson("access-2", "refresh-2")))
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "token_expired")))
        val h = http(FakeTokenStore(session("x")))

        assertEquals(401, h.sessionApi.logout().code())
        assertEquals(3, server.requestCount)
    }

    @Test
    fun `token hampir habis di-refresh sebelum request dikirim`() = runBlocking {
        server.enqueue(MockResponse().setBody(tokenJson("access-2", "refresh-2")))
        server.enqueue(MockResponse().setResponseCode(204))
        val almostExpired = session("x", expiresAt = NOW_MS + 10_000)
        val h = http(FakeTokenStore(almostExpired))

        assertEquals(204, h.sessionApi.logout().code())

        assertEquals("/v1/auth/refresh", server.takeRequest().path)
        assertEquals("Bearer access-2", server.takeRequest().bearer())
    }

    @Test
    fun `request bersamaan mengantre pada satu refresh saja`() {
        val refreshCalls = AtomicInteger()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.path == "/v1/auth/refresh" -> {
                    refreshCalls.incrementAndGet()
                    Thread.sleep(150) // refresh lambat agar request lain sempat mengantre
                    MockResponse().setBody(tokenJson("access-2", "refresh-2"))
                }
                request.bearer() == "Bearer access-2" -> MockResponse().setResponseCode(204)
                else -> MockResponse().setResponseCode(401).setBody(problemJson(401, "token_expired"))
            }
        }
        val store = FakeTokenStore(session("x"))
        val h = http(store)

        val codes = runBlocking {
            (1..8).map { async(Dispatchers.IO) { h.sessionApi.logout().code() } }.awaitAll()
        }

        assertEquals(List(8) { 204 }, codes)
        assertEquals("refresh token hanya boleh dipakai sekali", 1, refreshCalls.get())
        assertEquals("refresh-2", runBlocking { store.current() }?.refreshToken)
    }

    @Test
    fun `refresh token ditolak mengakhiri sesi dan menandai kedaluwarsa`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "token_expired")))
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "refresh_token_expired")))
        val store = FakeTokenStore(session("x"))
        val h = http(store)

        assertEquals(401, h.sessionApi.logout().code())

        assertNull(store.current())
        assertTrue(h.events.expired.value)
    }

    @Test
    fun `server error saat refresh tidak menghapus sesi`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "token_expired")))
        server.enqueue(MockResponse().setResponseCode(503))
        val store = FakeTokenStore(session("x"))
        val h = http(store)

        val failure = runCatching { h.sessionApi.logout() }.exceptionOrNull()

        assertNotNull("gangguan sementara harus muncul sebagai kegagalan jaringan", failure)
        assertEquals("refresh-1", store.current()?.refreshToken)
        assertEquals(false, h.events.expired.value)
    }
}
