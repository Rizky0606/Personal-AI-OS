package app.aios.android.data.realtime

import app.aios.android.data.api.NoServerException
import app.aios.android.data.api.ServerEndpoint
import app.aios.android.data.auth.TokenRefresher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** WebSocket OkHttp ke `{server}/v1/ws`. Autentikasi lewat header Authorization saat handshake. */
class OkHttpWsTransport(
    private val client: OkHttpClient,
    private val endpoint: ServerEndpoint
) : WsTransport {
    override fun open(token: String, listener: WsListener): WsHandle {
        val base = endpoint.get() ?: throw NoServerException()
        val url = base.newBuilder()
            .encodedPath(base.encodedPath.trimEnd('/') + "/v1/ws")
            .build()
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        val socket = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = listener.onOpen()

                override fun onMessage(webSocket: WebSocket, text: String) = listener.onMessage(text)

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = listener.onClosed(code, reason)

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                    listener.onFailure(t, response?.code)
            }
        )
        return object : WsHandle {
            override fun send(text: String) = socket.send(text)

            override fun close(code: Int, reason: String) {
                socket.close(code, reason)
            }
        }
    }
}

class RefresherTokenSource(private val refresher: TokenRefresher) : TokenSource {
    override suspend fun token(): String? = refresher.validAccessToken()

    override suspend fun refreshed(stale: String): String? = refresher.refreshAfterUnauthorized(stale)
}
