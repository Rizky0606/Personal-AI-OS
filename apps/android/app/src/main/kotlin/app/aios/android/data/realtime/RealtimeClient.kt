package app.aios.android.data.realtime

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlin.math.min

/** Callback dari soket; diimplementasikan OkHttp di produksi dan soket palsu di tes. */
interface WsListener {
    fun onOpen()

    fun onMessage(text: String)

    fun onClosed(code: Int, reason: String)

    /** [httpCode] terisi bila handshake ditolak server (mis. 401). */
    fun onFailure(error: Throwable, httpCode: Int?)
}

interface WsHandle {
    fun send(text: String): Boolean

    fun close(code: Int, reason: String)
}

/** Membuka soket ke `/v1/ws` dengan token di header Authorization. Boleh melempar IOException. */
fun interface WsTransport {
    fun open(token: String, listener: WsListener): WsHandle
}

interface TokenSource {
    suspend fun token(): String?

    /** Token baru setelah server menolak [stale]; null bila sesi sudah berakhir. */
    suspend fun refreshed(stale: String): String?
}

sealed interface ConnectionState {
    data object Idle : ConnectionState

    data object Connecting : ConnectionState

    data object Connected : ConnectionState

    /** Putus dan sedang menunggu giliran sambung ulang ke-[attempt]. */
    data class Reconnecting(val attempt: Int) : ConnectionState
}

data class ChannelEvent(val seq: Long, val event: ServerEvent)

/** Jeda sambung ulang: 1, 2, 4, ... detik sampai batas 30 detik. */
class Backoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 30_000,
    private val jitter: (Long) -> Long = { it }
) {
    fun delayMs(attempt: Int): Long {
        val exp = min(attempt - 1, MAX_SHIFT).coerceAtLeast(0)
        return jitter(min(maxMs, baseMs shl exp)).coerceIn(baseMs, maxMs)
    }

    private companion object {
        const val MAX_SHIFT = 16
    }
}

private const val CLOSE_NORMAL = 1000
private const val CLOSE_UNAUTHORIZED = 4401
private const val HTTP_UNAUTHORIZED = 401
private const val EVENT_BUFFER = 4096

/**
 * Satu koneksi WebSocket bersama untuk semua channel. Langganan dilacak per channel; saat koneksi
 * putus klien menyambung ulang dengan backoff dan berlangganan lagi dengan `lastSeq` terakhir, sehingga
 * event yang terlewat diputar ulang server tanpa ada yang hilang atau ganda (channel `run:*`).
 */
class RealtimeClient(
    private val scope: CoroutineScope,
    private val transport: WsTransport,
    private val tokens: TokenSource,
    private val backoff: Backoff = Backoff(),
    private val lingerMs: Long = 30_000,
    private val log: (String) -> Unit = {}
) {
    private class Sub {
        val events = MutableSharedFlow<ChannelEvent>(extraBufferCapacity = EVENT_BUFFER)
        var refs = 0
        var lastSeq = 0L
    }

    private sealed interface Item {
        data object Opened : Item

        data class Message(val text: String) : Item

        data class Closed(val code: Int) : Item

        data class Failed(val httpCode: Int?) : Item

        data class Subscribe(val channel: String) : Item

        data class Unsubscribe(val channel: String) : Item

        data object Stop : Item
    }

    /** [immediate]: token baru sudah didapat, sambung lagi tanpa menunggu backoff. */
    private data class Outcome(
        val code: Int?,
        val connected: Boolean,
        val stop: Boolean = false,
        val immediate: Boolean = false,
        /** Tidak ada sesi (token null): jangan menyala lagi sampai ada pelanggan baru. */
        val noSession: Boolean = false
    )

    private val lock = Any()
    private val subs = HashMap<String, Sub>()
    private var loop: Job? = null
    private var running = false

    @Volatile
    private var live: Channel<Item>? = null
    private val kick = Channel<Unit>(Channel.CONFLATED)
    private val json = Json { ignoreUnknownKeys = true }

    private val stateFlow = MutableStateFlow<ConnectionState>(ConnectionState.Idle)
    val state: StateFlow<ConnectionState> = stateFlow

    /**
     * Event sebuah channel. Mengumpulkan flow ini berlangganan; menghentikan pengumpulan berhenti
     * berlangganan. Event channel `run:*` yang sudah pernah diterima tidak dikirim dua kali.
     */
    fun channel(name: String): Flow<ChannelEvent> = flow {
        val sub = acquire(name)
        try {
            sub.events.onSubscription { announce(Item.Subscribe(name)) }.collect { emit(it) }
        } finally {
            release(name)
        }
    }

    /** Mencoba menyambung sekarang (mis. jaringan baru kembali) tanpa menunggu sisa backoff. */
    fun reconnectNow() {
        // Hanya berarti saat sedang menunggu giliran; tanpa ini sinyal basi akan melompati backoff berikutnya.
        if (stateFlow.value is ConnectionState.Reconnecting) kick.trySend(Unit)
    }

    private fun acquire(name: String): Sub = synchronized(lock) {
        val sub = subs.getOrPut(name) { Sub() }
        sub.refs++
        if (!running) {
            running = true
            loop = scope.launch { runLoop() }
        }
        sub
    }

    private fun release(name: String) {
        val none = synchronized(lock) {
            val sub = subs[name] ?: return
            sub.refs--
            if (sub.refs <= 0) subs.remove(name)
            subs.isEmpty()
        }
        live?.trySend(Item.Unsubscribe(name))
        if (none) {
            scope.launch {
                delay(lingerMs)
                if (synchronized(lock) { subs.isEmpty() }) live?.trySend(Item.Stop)
            }
        }
    }

    private fun announce(item: Item) {
        live?.trySend(item)
    }

    private fun hasSubs() = synchronized(lock) { subs.isNotEmpty() }

    private suspend fun runLoop() {
        var attempt = 0
        var noSession = false
        try {
            while (hasSubs()) {
                stateFlow.value = if (attempt == 0) {
                    ConnectionState.Connecting
                } else {
                    ConnectionState.Reconnecting(attempt)
                }
                val outcome = connectOnce()
                if (outcome.stop) {
                    noSession = outcome.noSession
                    break
                }
                if (outcome.connected) attempt = 0
                attempt++
                if (!hasSubs()) break
                stateFlow.value = ConnectionState.Reconnecting(attempt)
                // Menunggu backoff, tetapi bangun lebih awal bila jaringan kembali (reconnectNow).
                if (!outcome.immediate) withTimeoutOrNull(backoff.delayMs(attempt)) { kick.receive() }
            }
        } finally {
            stateFlow.value = ConnectionState.Idle
        }
        // Langganan baru yang masuk saat loop berhenti tidak boleh tertinggal tanpa koneksi.
        val again = synchronized(lock) {
            val restart = subs.isNotEmpty() && !noSession
            if (!restart) running = false
            restart
        }
        if (again) loop = scope.launch { runLoop() }
    }

    private suspend fun connectOnce(): Outcome {
        kick.tryReceive()
        val token = try {
            tokens.token()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log("token gagal: ${e.javaClass.simpleName}")
            return Outcome(null, connected = false)
        } ?: return Outcome(null, connected = false, stop = true, noSession = true)

        val items = Channel<Item>(Channel.UNLIMITED)
        val listener = object : WsListener {
            override fun onOpen() {
                items.trySend(Item.Opened)
            }

            override fun onMessage(text: String) {
                items.trySend(Item.Message(text))
            }

            override fun onClosed(code: Int, reason: String) {
                items.trySend(Item.Closed(code))
            }

            override fun onFailure(error: Throwable, httpCode: Int?) {
                items.trySend(Item.Failed(httpCode))
            }
        }
        val handle = try {
            transport.open(token, listener)
        } catch (e: java.io.IOException) {
            log("soket gagal dibuka: ${e.javaClass.simpleName}")
            return Outcome(null, connected = false)
        }
        live = items
        var connected = false
        val onWire = HashSet<String>()
        try {
            for (item in items) {
                when (item) {
                    Item.Opened -> {
                        connected = true
                        stateFlow.value = ConnectionState.Connected
                        synchronized(lock) { subs.keys.toList() }.forEach { subscribe(handle, it, onWire) }
                    }
                    is Item.Subscribe -> if (connected) subscribe(handle, item.channel, onWire)
                    is Item.Unsubscribe -> if (onWire.remove(item.channel)) {
                        handle.send(Frames.unsubscribe(item.channel))
                    }
                    is Item.Message -> dispatch(Frames.parse(item.text, json))
                    is Item.Closed -> return outcomeFor(item.code, connected, token)
                    is Item.Failed -> return outcomeFor(
                        if (item.httpCode == HTTP_UNAUTHORIZED) CLOSE_UNAUTHORIZED else null,
                        connected,
                        token
                    )
                    Item.Stop -> {
                        handle.close(CLOSE_NORMAL, "idle")
                        return Outcome(null, connected, stop = true)
                    }
                }
            }
            return Outcome(null, connected)
        } finally {
            live = null
            items.close()
        }
    }

    /** Token ditolak (handshake 401 atau close 4401): minta token baru lalu sambung lagi tanpa jeda. */
    private suspend fun outcomeFor(code: Int?, connected: Boolean, token: String): Outcome {
        if (code != CLOSE_UNAUTHORIZED) return Outcome(code, connected)
        val fresh = try {
            tokens.refreshed(token)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log("refresh gagal: ${e.javaClass.simpleName}")
            null
        }
        // Tanpa token baru: lanjut lewat backoff; bila sesi sudah berakhir, token() berikutnya null dan loop berhenti.
        return Outcome(code, connected, immediate = fresh != null)
    }

    private fun subscribe(handle: WsHandle, channel: String, onWire: MutableSet<String>) {
        if (!onWire.add(channel)) return
        val last = synchronized(lock) { subs[channel]?.lastSeq ?: 0L }
        handle.send(Frames.subscribe(channel, last))
    }

    private suspend fun dispatch(frame: Frame) {
        if (frame !is Frame.Envelope) return
        val sub = synchronized(lock) { subs[frame.channel] } ?: return
        if (frame.channel.startsWith("run:")) {
            if (frame.seq <= sub.lastSeq) return
            sub.lastSeq = frame.seq
        }
        sub.events.emit(ChannelEvent(frame.seq, frame.event))
    }
}
