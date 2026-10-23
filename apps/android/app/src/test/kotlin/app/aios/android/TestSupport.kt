package app.aios.android

import app.aios.android.data.api.AuthInterceptor
import app.aios.android.data.api.BaseUrlInterceptor
import app.aios.android.data.api.PublicAuthApi
import app.aios.android.data.api.ServerEndpoint
import app.aios.android.data.api.SessionApi
import app.aios.android.data.api.TokenAuthenticator
import app.aios.android.data.api.TokenPair
import app.aios.android.data.auth.SessionEvents
import app.aios.android.data.auth.StoredSession
import app.aios.android.data.auth.TokenRefresher
import app.aios.android.data.auth.TokenStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockWebServer
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

const val NOW_MS = 1_000_000L

class FakeTokenStore(initial: StoredSession? = null, lastUrl: String? = null) : TokenStore {
    private val state = MutableStateFlow(initial)
    private val last = MutableStateFlow(lastUrl ?: initial?.serverUrl)

    override val session = state
    override val lastServerUrl = last.map { it }

    override suspend fun current() = state.value

    override suspend fun lastServerUrlOnce() = last.value

    override suspend fun save(session: StoredSession) {
        state.value = session
        last.value = session.serverUrl
    }

    override suspend fun updateTokens(tokens: TokenPair, nowMs: Long) {
        val s = state.value ?: return
        state.value = s.copy(
            accessToken = tokens.accessToken,
            refreshToken = tokens.refreshToken,
            accessExpiresAtMs = nowMs + tokens.expiresIn * 1000L
        )
    }

    override suspend fun clear() {
        state.value = null
    }
}

fun session(
    server: String,
    access: String = "access-1",
    refresh: String = "refresh-1",
    expiresAt: Long = NOW_MS + 15 * 60_000
) = StoredSession(
    serverUrl = server,
    accessToken = access,
    refreshToken = refresh,
    accessExpiresAtMs = expiresAt,
    deviceId = "0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f",
    deviceName = "Pixel 8"
)

val testJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/** Susunan klien yang sama dengan AppModule, diarahkan ke MockWebServer. */
class TestHttp(server: MockWebServer, val store: TokenStore, clock: () -> Long = { NOW_MS }) {
    val endpoint = ServerEndpoint(load = { null }).also { it.set(server.url("/").toString().toHttpUrl()) }
    val events = SessionEvents()

    private fun retrofit(client: OkHttpClient) = Retrofit.Builder()
        .baseUrl("https://aios.invalid/v1/")
        .client(client)
        .addConverterFactory(testJson.asConverterFactory("application/json; charset=UTF-8".toMediaType()))
        .build()

    val publicApi: PublicAuthApi = retrofit(
        OkHttpClient.Builder().addInterceptor(BaseUrlInterceptor(endpoint)).build()
    ).create(PublicAuthApi::class.java)

    val refresher = TokenRefresher(store, publicApi, events, clock)

    val sessionApi: SessionApi = retrofit(
        OkHttpClient.Builder()
            .addInterceptor(BaseUrlInterceptor(endpoint))
            .addInterceptor(AuthInterceptor(refresher))
            .authenticator(TokenAuthenticator(refresher))
            .build()
    ).create(SessionApi::class.java)
}

fun tokenJson(access: String, refresh: String, expiresIn: Int = 900) =
    """{"accessToken":"$access","refreshToken":"$refresh","expiresIn":$expiresIn}"""

fun problemJson(status: Int, code: String, detail: String = "detail") =
    """{"type":"urn:aios:problem:$code","title":"t","status":$status,"detail":"$detail","code":"$code"}"""
