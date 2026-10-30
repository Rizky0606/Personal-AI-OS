package app.aios.android

import app.aios.android.data.realtime.ServerEvent
import app.aios.android.ui.chat.activity.ActivityPhase
import app.aios.android.ui.chat.activity.RunTrace
import app.aios.android.ui.chat.activity.SharedTicker
import app.aios.android.ui.chat.activity.phase
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SharedTickerTest {
    @Test
    fun duaPelangganBerbagiSatuLoopDanTanpaPelangganTidakAdaLoop() = runTest {
        var calls = 0
        val ticker = SharedTicker(backgroundScope, periodMs = 1_000) { calls++.toLong() + 1 }

        // Tanpa pelanggan: tidak ada yang berjalan sama sekali.
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(0, calls)

        val a = mutableListOf<Long>()
        val b = mutableListOf<Long>()
        val jobA: Job = launch { ticker.now.collect { a += it } }
        val jobB: Job = launch { ticker.now.collect { b += it } }
        runCurrent()
        advanceTimeBy(2_500)
        runCurrent()
        // Waktu 0, 1000, 2000: tiga pembacaan jam untuk dua pelanggan (bukan enam).
        assertEquals(3, calls)
        assertEquals(a, b)

        jobA.cancel()
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals("satu pelanggan tersisa masih menerima", 5, calls)

        jobB.cancel()
        runCurrent()
        val callsAtStop = calls
        advanceTimeBy(10_000)
        runCurrent()
        assertEquals("tanpa pelanggan, loop berhenti", callsAtStop, calls)
    }

    @Test
    fun pelangganBaruSetelahBerhentiMendapatNilaiSegarBukanSisa() = runTest {
        var now = 100L
        val ticker = SharedTicker(backgroundScope, periodMs = 1_000) { now }
        val first = launch { ticker.now.collect { } }
        runCurrent()
        first.cancel()
        runCurrent()
        now = 9_000L
        val seen = mutableListOf<Long>()
        val second = launch { ticker.now.collect { seen += it } }
        runCurrent()
        assertEquals(listOf(9_000L), seen)
        second.cancel()
    }
}

class RunTraceTest {
    private fun trace(vararg events: Pair<ServerEvent, Long?>): RunTrace =
        events.fold(RunTrace()) { t, (e, ts) -> t.reduce(e, ts) }

    @Test
    fun permintaanIzinMembuatFaseMenungguIzinSampaiDiputuskan() {
        val waiting = trace(
            ServerEvent.RunStatus("running") to 1_000L,
            ServerEvent.ApprovalRequested("a1") to 2_000L
        )
        assertEquals(ActivityPhase.WaitingApproval, waiting.phase())
        val resolved = waiting.reduce(ServerEvent.ApprovalResolved("a1"), 3_000L)
        assertEquals(ActivityPhase.Thinking, resolved.phase())
    }

    @Test
    fun waktuMulaiSelesaiDanEventTerakhirDariEnvelope() {
        val t = trace(
            ServerEvent.RunStatus("running") to 5_000L,
            ServerEvent.MessageDelta("m", "x") to 6_000L,
            ServerEvent.RunStatus("completed") to 9_000L,
            ServerEvent.MessageCompleted("m") to 9_500L
        )
        assertEquals(5_000L, t.startedAt)
        assertEquals(9_000L, t.endedAt)
        assertEquals(9_500L, t.lastEventAt)
        assertEquals(true, t.settled)
    }

    @Test
    fun tanpaWaktuServerWaktuTidakDiisi() {
        val t = trace(ServerEvent.RunStatus("running") to null)
        assertNull(t.startedAt)
        assertNull(t.endedAt)
    }

    @Test
    fun withRunStartMemajukanWaktuMulaiBilaLebihAwal() {
        val t = trace(ServerEvent.RunStatus("running") to 5_000L)
        assertEquals(1_000L, t.withRunStart(1_000L).startedAt)
        assertEquals(5_000L, t.withRunStart(9_000L).startedAt)
    }
}
