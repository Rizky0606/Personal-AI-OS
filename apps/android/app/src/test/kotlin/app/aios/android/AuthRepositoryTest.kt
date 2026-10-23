package app.aios.android

import app.aios.android.data.api.ApiError
import app.aios.android.data.api.ServerUrlResult
import app.aios.android.data.auth.AuthRepository
import app.aios.android.data.auth.LoginOutcome
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var store: FakeTokenStore
    private lateinit var http: TestHttp
    private lateinit var repo: AuthRepository
    private var connected = true

    private val loginOk = """
        {"accessToken":"acc","refreshToken":"ref","expiresIn":900,
         "device":{"id":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f","kind":"android","name":"Pixel 8",
                   "scopes":["app"],"lastSeenAt":null,"createdAt":"2026-10-22T06:00:00.000Z"}}
    """.trimIndent()

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        store = FakeTokenStore(null)
        http = TestHttp(server, store)
        repo = AuthRepository(
            store = store,
            publicApi = http.publicApi,
            sessionApi = http.sessionApi,
            endpoint = http.endpoint,
            events = http.events,
            deviceName = "Pixel 8",
            allowCleartextLocal = true,
            isConnected = { connected },
            clock = { NOW_MS }
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private val serverInput get() = server.url("/").toString().trimEnd('/')

    @Test
    fun `login berhasil menyimpan sesi dan mengirim perangkat android tanpa pushToken`() = runBlocking {
        server.enqueue(MockResponse().setBody(loginOk))

        val outcome = repo.login(serverInput, "rahasia-panjang", "123456")

        assertEquals(LoginOutcome.Success, outcome)
        val saved = store.current()!!
        assertEquals("acc", saved.accessToken)
        assertEquals("ref", saved.refreshToken)
        assertEquals(NOW_MS + 900_000, saved.accessExpiresAtMs)
        assertEquals(serverInput, saved.serverUrl)
        assertEquals("Pixel 8", saved.deviceName)

        val request = server.takeRequest()
        assertEquals("/v1/auth/login", request.path)
        assertNull(request.getHeader("Authorization"))
        val body = request.body.readUtf8()
        assertTrue(body, body.contains(""""kind":"android""""))
        assertTrue(body, body.contains(""""totp":"123456""""))
        assertTrue("pushToken kosong tidak dikirim: $body", !body.contains("pushToken"))
    }

    @Test
    fun `login salah memberi pesan kredensial dan tidak menyimpan apa pun`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody(problemJson(401, "invalid_credentials")))

        val outcome = repo.login(serverInput, "salah", "123456") as LoginOutcome.Failure

        assertEquals(ApiError.Kind.Unauthorized, outcome.error.kind)
        assertEquals(R.string.error_invalid_credentials, outcome.error.messageRes)
        assertNull(store.current())
    }

    @Test
    fun `rate limit dan server error dipetakan`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(429).setBody(problemJson(429, "rate_limited")))
        server.enqueue(MockResponse().setResponseCode(500).setBody(problemJson(500, "internal_error")))

        assertEquals(
            ApiError.Kind.RateLimited,
            (repo.login(serverInput, "p", "123456") as LoginOutcome.Failure).error.kind
        )
        assertEquals(ApiError.Kind.Server, (repo.login(serverInput, "p", "123456") as LoginOutcome.Failure).error.kind)
    }

    @Test
    fun `alamat tidak valid ditolak sebelum ada request`() = runBlocking {
        val outcome = repo.login("", "p", "123456") as LoginOutcome.BadServer

        assertEquals(ServerUrlResult.Empty, outcome.reason)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `server mati dibedakan dari tidak ada internet`() = runBlocking {
        server.shutdown()

        connected = true
        val unreachable = repo.login(serverInput, "p", "123456") as LoginOutcome.Failure
        assertEquals(ApiError.Kind.Unreachable, unreachable.error.kind)

        connected = false
        val offline = repo.login(serverInput, "p", "123456") as LoginOutcome.Failure
        assertEquals(ApiError.Kind.Offline, offline.error.kind)
    }

    @Test
    fun `logout mencabut di server lalu menghapus sesi lokal`() = runBlocking {
        server.enqueue(MockResponse().setBody(loginOk))
        repo.login(serverInput, "p", "123456")
        server.takeRequest()
        server.enqueue(MockResponse().setResponseCode(204))

        repo.logout()

        val request = server.takeRequest()
        assertEquals("/v1/auth/logout", request.path)
        assertEquals("Bearer acc", request.getHeader("Authorization"))
        assertNull(store.current())
        assertEquals("alamat server terakhir tetap diingat", serverInput, store.lastServerUrlOnce())
    }

    @Test
    fun `logout tetap menghapus sesi lokal walau server tidak terjangkau`() = runBlocking {
        server.enqueue(MockResponse().setBody(loginOk))
        repo.login(serverInput, "p", "123456")
        server.shutdown()

        repo.logout()

        assertNull(store.current())
    }
}
