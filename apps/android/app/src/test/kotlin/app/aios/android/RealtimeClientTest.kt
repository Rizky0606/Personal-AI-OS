package app.aios.android

import app.aios.android.data.realtime.Backoff
import app.aios.android.data.realtime.ChannelEvent
import app.aios.android.data.realtime.ConnectionState
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.Timeout

@OptIn(ExperimentalCoroutinesApi::class)
class RealtimeClientTest {
    /** Tes dengan jam virtual yang salah bisa berputar selamanya; batas waktu membuatnya gagal dengan nama jelas. */
    @get:Rule
    val timeout: Timeout = Timeout.seconds(30)

    private class Rig(scope: TestScope) {
        val ws = FakeWsTransport().also { it.clock = { scope.currentTime } }
        val tokens = FakeTokens()
        val client = RealtimeClient(scope.backgroundScope, ws, tokens, Backoff(), lingerMs = 10_000)
        val events = mutableListOf<ChannelEvent>()

        fun collect(scope: TestScope, channel: String) {
            scope.backgroundScope.launch { client.channel(channel).collect { events += it } }
            scope.runCurrent()
        }

        val texts get() = events.mapNotNull { (it.event as? ServerEvent.MessageDelta)?.text }
    }

    @Test
    fun `berlangganan saat terbuka dengan lastSeq 0 dan meneruskan event berurutan`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")

        assertEquals(ConnectionState.Connecting, r.client.state.value)
        val conn = r.ws.connections.single()
        assertEquals("tok-1", conn.token)
        conn.open()
        runCurrent()
        assertEquals(ConnectionState.Connected, r.client.state.value)
        assertEquals(listOf("run:r1" to 0L), conn.subscribes())

        conn.server(envelope("run:r1", 1, delta("m", "Ha")))
        conn.server(envelope("run:r1", 2, delta("m", "lo")))
        runCurrent()

        assertEquals(listOf("Ha", "lo"), r.texts)
    }

    @Test
    fun `seq yang sudah diterima di channel run tidak dikirim dua kali`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")
        val conn = r.ws.connections.single().also { it.open() }
        conn.server(envelope("run:r1", 1, delta("m", "A")))
        conn.server(envelope("run:r1", 1, delta("m", "A")))
        conn.server(envelope("run:r1", 2, delta("m", "B")))
        conn.server(envelope("run:r1", 2, delta("m", "B")))
        runCurrent()

        assertEquals(listOf("A", "B"), r.texts)
    }

    @Test
    fun `putus lalu sambung ulang berlangganan dengan lastSeq terakhir tanpa event hilang atau ganda`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")
        val first = r.ws.connections.single().also { it.open() }
        first.server(envelope("run:r1", 1, delta("m", "Ha")))
        first.server(envelope("run:r1", 2, delta("m", "lo")))
        runCurrent()

        first.drop()
        runCurrent()
        assertEquals(ConnectionState.Reconnecting(1), r.client.state.value)
        assertEquals("belum menyambung sebelum 1 detik", 1, r.ws.connections.size)

        advanceTimeBy(1_000)
        runCurrent()
        val second = r.ws.connections[1]
        second.open()
        runCurrent()
        assertEquals(listOf("run:r1" to 2L), second.subscribes())

        // Server memutar ulang dari awal: yang lama dibuang, hanya seq 3 yang baru.
        second.server(envelope("run:r1", 1, delta("m", "Ha")))
        second.server(envelope("run:r1", 2, delta("m", "lo")))
        second.server(envelope("run:r1", 3, delta("m", " dunia")))
        runCurrent()

        assertEquals(listOf("Ha", "lo", " dunia"), r.texts)
        assertEquals(ConnectionState.Connected, r.client.state.value)
    }

    @Test
    fun `backoff 1 2 4 8 16 lalu tertahan di 30 detik, dan reset setelah berhasil tersambung`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")

        // Timer klien hidup di backgroundScope; advanceUntilIdle tidak menunggunya, jadi waktu dimajukan eksplisit.
        // Tiap koneksi diputus tepat saat dibuat: jedanya naik dan tidak melewati 30 detik.
        listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L).forEach { wait ->
            val before = r.ws.connections.size
            r.ws.connections.last().drop()
            runCurrent()
            advanceTimeBy(wait - 1)
            runCurrent()
            assertEquals("belum boleh menyambung sebelum $wait ms", before, r.ws.connections.size)
            advanceTimeBy(1)
            runCurrent()
            assertEquals("harus menyambung tepat setelah $wait ms", before + 1, r.ws.connections.size)
        }

        // Sekali berhasil tersambung, hitungan mulai dari 1 detik lagi.
        val conn = r.ws.connections.last().also { it.open() }
        runCurrent()
        val before = r.ws.connections.size
        conn.drop()
        runCurrent()
        advanceTimeBy(999)
        runCurrent()
        assertEquals(before, r.ws.connections.size)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(before + 1, r.ws.connections.size)
    }

    @Test
    fun `close 4401 meminta token baru dan menyambung lagi tanpa jeda`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")
        val first = r.ws.connections.single().also { it.open() }
        runCurrent()

        first.closeFromServer(4401)
        runCurrent()

        assertEquals(listOf("tok-1"), r.tokens.refreshedCalls)
        assertEquals(2, r.ws.connections.size)
        assertEquals("tok-2", r.ws.connections[1].token)
        assertEquals(currentTime, r.ws.openTimes.last())
    }

    @Test
    fun `handshake 401 diperlakukan sama seperti 4401`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")
        r.ws.connections.single().rejectHandshake(401)
        runCurrent()

        assertEquals(listOf("tok-1"), r.tokens.refreshedCalls)
        assertEquals("tok-2", r.ws.connections.last().token)
    }

    @Test
    fun `tanpa sesi klien berhenti dan berstatus Idle`() = runTest {
        val r = Rig(this)
        r.tokens.current = null
        r.collect(this, "run:r1")
        advanceUntilIdle()

        assertTrue(r.ws.connections.isEmpty())
        assertEquals(ConnectionState.Idle, r.client.state.value)
    }

    @Test
    fun `reconnectNow melewati sisa backoff`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")
        repeat(3) {
            r.ws.connections.last().drop()
            advanceTimeBy(31_000)
            runCurrent()
        }
        val before = r.ws.connections.size
        r.ws.connections.last().drop()
        runCurrent()
        assertEquals(before, r.ws.connections.size)

        r.client.reconnectNow()
        runCurrent()

        assertEquals(before + 1, r.ws.connections.size)
    }

    @Test
    fun `tanpa pelanggan koneksi ditutup setelah masa tunggu`() = runTest {
        val r = Rig(this)
        val job = backgroundScope.launch { r.client.channel("run:r1").collect { } }
        runCurrent()
        val conn = r.ws.connections.single().also { it.open() }
        runCurrent()

        job.cancel()
        runCurrent()
        assertEquals(listOf("run:r1"), conn.sent.filter { it.contains("unsubscribe") }.map { "run:r1" })
        assertEquals(null, conn.closedWith)

        advanceTimeBy(10_001)
        runCurrent()
        assertNotNull(conn.closedWith)
        assertEquals(ConnectionState.Idle, r.client.state.value)
    }

    @Test
    fun `channel live tidak membuang event setelah server restart dan seq mulai dari awal`() = runTest {
        val r = Rig(this)
        r.collect(this, "user")
        val first = r.ws.connections.single().also { it.open() }
        first.server(envelope("user", 7, delta("m", "x")))
        runCurrent()

        first.drop()
        advanceTimeBy(1_000)
        runCurrent()
        val second = r.ws.connections[1].also { it.open() }
        second.server(envelope("user", 1, delta("m", "y")))
        runCurrent()

        assertEquals(listOf("x", "y"), r.texts)
    }

    @Test
    fun `frame rusak atau tidak dikenal diabaikan tanpa memutus koneksi`() = runTest {
        val r = Rig(this)
        r.collect(this, "run:r1")
        val conn = r.ws.connections.single().also { it.open() }
        conn.server("bukan json")
        conn.server("""{"type":"pong"}""")
        conn.server(subscribed("run:r1"))
        conn.server(envelope("run:r1", 1, """{"type":"diff.updated","files":[]}"""))
        conn.server(envelope("run:r1", 2, delta("m", "ok")))
        runCurrent()

        assertEquals(ConnectionState.Connected, r.client.state.value)
        assertEquals(listOf("ok"), r.texts)
        assertEquals(ServerEvent.Other("diff.updated"), r.events.first().event)
    }
}
