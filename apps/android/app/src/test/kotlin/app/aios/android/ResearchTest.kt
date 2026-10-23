package app.aios.android

import androidx.lifecycle.SavedStateHandle
import app.aios.android.data.api.Page
import app.aios.android.data.api.ResearchJob
import app.aios.android.data.api.ResearchJobDetail
import app.aios.android.data.api.ResearchPlan
import app.aios.android.data.api.ResearchSource
import app.aios.android.data.realtime.Backoff
import app.aios.android.data.realtime.Frame
import app.aios.android.data.realtime.Frames
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.data.research.ExportFormat
import app.aios.android.data.research.ExportedFile
import app.aios.android.data.research.RemoteResearchRepository
import app.aios.android.data.research.ResearchRepository
import app.aios.android.ui.research.ReportParser
import app.aios.android.ui.research.RelativeTime
import app.aios.android.ui.research.ResearchDetailViewModel
import app.aios.android.ui.research.ResearchEvent
import app.aios.android.ui.research.ResearchFormViewModel
import app.aios.android.ui.research.ResearchListViewModel
import app.aios.android.ui.research.continuationPrompt
import app.aios.android.ui.research.overallFraction
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.Timeout
import java.io.IOException
import java.time.ZoneId

private const val REPORT = """# Kendaraan listrik

Penjualan naik 40% pada 2025 [1]. Harga baterai turun [2][1].

Batasan: data Indonesia terbatas.

## Daftar sumber

- [1] [Laporan IEA (2025)](https://iea.org/ev?x=1) — iea.org, diakses 2026-10-22
- [2] [Berita Kontan](https://kontan.co.id/a_(b)) — kontan.co.id, diakses 2026-10-22
- [3] [Tautan berbahaya](javascript:alert(1)) — x, diakses 2026-10-22
"""

fun job(
    id: String = "j1",
    status: String = "running",
    report: String? = null,
    plan: List<String>? = null,
    runId: String? = "rr1",
    question: String = "Bagaimana kendaraan listrik di Asia Tenggara?"
) = ResearchJob(id, question, "standard", status, plan?.let { ResearchPlan(it) }, report, runId, TS, TS)

class FakeResearchRepo : ResearchRepository {
    var jobs = mutableListOf<ResearchJob>()
    var detail: ResearchJobDetail? = null
    var sources = listOf<ResearchSource>()
    var failGet: Exception? = null
    var getCalls = 0
    val created = mutableListOf<Pair<String, String>>()
    val cancelled = mutableListOf<String>()
    var exportResult: ExportedFile? = ExportedFile("riset-x.md", "text/markdown", "# x".toByteArray())
    var failExport: Exception? = null
    var pages: Map<String?, Page<ResearchJob>> = emptyMap()

    override suspend fun list(before: String?): Page<ResearchJob> = pages[before] ?: Page(jobs.toList(), null)

    override suspend fun create(question: String, depth: String): ResearchJob {
        created += question to depth
        return job(id = "new1", status = "queued", question = question).also { jobs.add(0, it) }
    }

    override suspend fun get(id: String): ResearchJobDetail {
        getCalls++
        failGet?.let { throw it }
        val current = detail ?: jobs.first { it.id == id }.let {
            ResearchJobDetail(it.id, it.question, it.depth, it.status, it.plan, it.reportMd, it.runId, TS, TS, sources)
        }
        return current
    }

    override suspend fun cancel(id: String): ResearchJob {
        cancelled += id
        return job(id, "cancelled")
    }

    override suspend fun export(job: ResearchJob, format: ExportFormat): ExportedFile {
        failExport?.let { throw it }
        return exportResult!!
    }

    fun setDetail(status: String, report: String? = null, plan: List<String>? = null) {
        detail = ResearchJobDetail(
            "j1", "Bagaimana kendaraan listrik di Asia Tenggara?", "standard", status,
            plan?.let {
                ResearchPlan(it)
            },
            report, "rr1", TS, TS, sources
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ResearchTest {
    /** Tes dengan jam virtual yang salah bisa berputar selamanya; batas waktu membuatnya gagal dengan nama jelas. */
    @get:Rule
    val timeout: Timeout = Timeout.seconds(30)

    private val scheduler = TestCoroutineScheduler()
    private val dispatcher = StandardTestDispatcher(scheduler)

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class Rig(scope: TestScope) {
        val repo = FakeResearchRepo()
        val chat = FakeChatRepo()
        val ws = FakeWsTransport().also { it.clock = { scope.currentTime } }
        val connectivity = FakeConnectivity()
        val realtime = RealtimeClient(scope.backgroundScope, ws, FakeTokens(), Backoff(), lingerMs = 60_000)
        val conn get() = ws.connections.last()
    }

    /** ViewModel buatan tes dihentikan di akhir; loop polling abadi di viewModelScope menahan runTest. */
    private val created = mutableListOf<ViewModel>()

    private fun runRig(block: suspend TestScope.(Rig) -> Unit) = runTest(dispatcher) {
        try {
            block(Rig(this))
        } finally {
            created.forEach { it.viewModelScope.cancel() }
            created.clear()
        }
    }

    private fun TestScope.detailVm(
        r: Rig,
        collected: MutableList<ResearchEvent> = mutableListOf()
    ): ResearchDetailViewModel {
        val vm =
            ResearchDetailViewModel(SavedStateHandle(mapOf("id" to "j1")), r.repo, r.chat, r.realtime, r.connectivity)
        created += vm
        backgroundScope.launch { vm.events.collect { collected += it } }
        return vm
    }

    /* ---------- parser laporan dan format ---------- */

    @Test
    fun `laporan dipisah menjadi isi dan daftar sumber, nomor mengacu ke daftar di laporan`() {
        val parsed = ReportParser.parse(REPORT)

        assertFalse(parsed.bodyMd.contains("Daftar sumber"))
        assertTrue(parsed.bodyMd.contains("[2][1]"))
        assertEquals(listOf(1, 2), parsed.sources.map { it.n })
        assertEquals("Laporan IEA (2025)", parsed.sources[0].title)
        assertEquals("https://iea.org/ev?x=1", parsed.citations[1])
        assertEquals("https://kontan.co.id/a_(b)", parsed.citations[2])
        assertEquals("iea.org, diakses 2026-10-22", parsed.sources[0].meta)
    }

    @Test
    fun `URL yang bukan http atau https dibuang dari daftar sumber`() {
        val parsed = ReportParser.parse(REPORT)
        assertTrue(parsed.sources.none { it.url.startsWith("javascript") })
        assertNull(parsed.citations[3])
    }

    @Test
    fun `laporan tanpa daftar sumber tetap utuh`() {
        val parsed = ReportParser.parse("# Judul\n\nIsi tanpa sumber.")
        assertEquals("# Judul\n\nIsi tanpa sumber.", parsed.bodyMd)
        assertTrue(parsed.sources.isEmpty())
    }

    @Test
    fun `waktu relatif`() {
        val now = java.time.Instant.parse("2026-10-22T12:00:00Z").toEpochMilli()
        val zone = ZoneId.of("Asia/Jakarta")
        assertEquals(RelativeTime.JustNow, RelativeTime.of("2026-10-22T11:59:40Z", now, zone))
        assertEquals(RelativeTime.Minutes(5), RelativeTime.of("2026-10-22T11:55:00Z", now, zone))
        assertEquals(RelativeTime.Hours(3), RelativeTime.of("2026-10-22T09:00:00Z", now, zone))
        assertEquals(RelativeTime.Date("20 Okt 2026"), RelativeTime.of("2026-10-20T09:00:00Z", now, zone))
        assertEquals(RelativeTime.Date("bukan tanggal".take(10)), RelativeTime.of("bukan tanggal", now, zone))
    }

    @Test
    fun `kemajuan keseluruhan dari tahap dan kemajuan dalam tahap`() {
        assertEquals(0f, overallFraction(-1, 0.5f), 0.001f)
        assertEquals(0.125f, overallFraction(0, 0.5f), 0.001f)
        assertEquals(0.75f, overallFraction(2, 1f), 0.001f)
        assertEquals(1f, overallFraction(3, 3f), 0.001f)
    }

    @Test
    fun `nama berkas ekspor dibersihkan dan memakai cadangan bila tidak sah`() {
        val j = job(id = "0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f")
        val safe = RemoteResearchRepository.safeFileName(
            "attachment; filename=\"riset-kendaraan-listrik.md\"",
            j,
            ExportFormat.Markdown
        )
        assertEquals("riset-kendaraan-listrik.md", safe)
        val evil = RemoteResearchRepository.safeFileName(
            "attachment; filename=\"../../etc/pa ss.md\"",
            j,
            ExportFormat.Markdown
        )
        assertFalse(evil.contains("/") || evil.contains(".."))
        assertTrue(evil.endsWith(".md"))
        val tail = j.id.takeLast(8)
        assertEquals("riset-$tail.pdf", RemoteResearchRepository.safeFileName(null, j, ExportFormat.Pdf))
        assertEquals(
            "riset-$tail.md",
            RemoteResearchRepository.safeFileName("attachment; filename=\"salah.pdf\"", j, ExportFormat.Markdown)
        )
    }

    @Test
    fun `event riset diurai dari frame server`() {
        fun parse(ch: String, ev: String) = (Frames.parse(envelope(ch, 1, ev), testJson) as Frame.Envelope).event
        assertEquals(
            ServerEvent.ResearchProgress("reading", 0.4, "Membaca 3 dari 12"),
            parse(
                "run:r",
                """{"type":"research.progress","stage":"reading","progress":0.4,"message":"Membaca 3 dari 12"}"""
            )
        )
        assertEquals(
            ServerEvent.ResearchSourceFound("s1", "https://a.com/x", "Judul"),
            parse("run:r", """{"type":"research.source","sourceId":"s1","url":"https://a.com/x","title":"Judul"}""")
        )
        assertEquals(
            ServerEvent.ResearchCompleted("j1", "r1"),
            parse("user", """{"type":"research.completed","researchId":"j1","runId":"r1"}""")
        )
    }

    /* ---------- layar detail: progres live ---------- */

    @Test
    fun `progres live - tahap, rencana begitu tersedia, sumber masuk, lalu laporan saat selesai`() = runRig { r ->
        r.repo.jobs += job(status = "running")
        val vm = detailVm(r)
        runCurrent()
        val conn = r.conn.also { it.open() }
        runCurrent()
        assertEquals(listOf("run:rr1" to 0L), conn.subscribes())
        assertNull(vm.ui.value.job?.plan)

        // Perencana selesai: rencana tersimpan di job dan tahap berpindah.
        r.repo.setDetail("running", plan = listOf("Apa pasarnya?", "Siapa pemainnya?"))
        conn.server(
            envelope(
                "run:rr1",
                1,
                """{"type":"research.progress","stage":"planning","progress":1,"message":"Rencana siap"}"""
            )
        )
        runCurrent()
        assertEquals("planning", vm.ui.value.live.stage)
        assertEquals(listOf("Apa pasarnya?", "Siapa pemainnya?"), vm.ui.value.job?.plan?.subQuestions)

        conn.server(envelope("run:rr1", 2, """{"type":"research.progress","stage":"searching","progress":0.5}"""))
        conn.server(
            envelope(
                "run:rr1",
                3,
                """{"type":"research.source","sourceId":"s1","url":"https://a.com/1","title":"Satu"}"""
            )
        )
        conn.server(
            envelope(
                "run:rr1",
                4,
                """{"type":"research.source","sourceId":"s2","url":"https://b.com/2","title":"Dua"}"""
            )
        )
        conn.server(
            envelope(
                "run:rr1",
                4,
                """{"type":"research.source","sourceId":"s2","url":"https://b.com/2","title":"Dua"}"""
            )
        )
        runCurrent()
        assertEquals(listOf("Satu", "Dua"), vm.ui.value.live.sources.map { it.title })
        assertEquals(0.5f, vm.ui.value.live.progress, 0.001f)

        r.repo.setDetail("completed", report = REPORT, plan = listOf("Apa pasarnya?"))
        conn.server(envelope("run:rr1", 5, status("completed")))
        runCurrent()

        assertEquals("completed", vm.ui.value.job?.status)
        assertEquals(2, vm.ui.value.report?.sources?.size)
    }

    @Test
    fun `membuka ulang saat job berjalan memutar ulang tahap dan sumber dari awal`() = runRig { r ->
        r.repo.jobs += job(status = "running")
        val vm = detailVm(r)
        runCurrent()
        val conn = r.conn.also { it.open() }
        runCurrent()

        // Replay server setelah aplikasi dibuka kembali.
        conn.server(envelope("run:rr1", 1, """{"type":"research.progress","stage":"reading","progress":0.2}"""))
        conn.server(
            envelope(
                "run:rr1",
                2,
                """{"type":"research.source","sourceId":"s1","url":"https://a.com/1","title":"Satu"}"""
            )
        )
        runCurrent()

        assertEquals("reading", vm.ui.value.live.stage)
        assertEquals(1, vm.ui.value.live.sources.size)
    }

    @Test
    fun `polling menutup job bila event penutup tidak sampai`() = runRig { r ->
        r.repo.jobs += job(status = "running")
        val vm = detailVm(r)
        runCurrent()
        r.conn.open()
        runCurrent()

        r.repo.setDetail("completed", report = REPORT)
        advanceTimeBy(5_001)
        runCurrent()

        assertEquals("completed", vm.ui.value.job?.status)
        assertNotNull(vm.ui.value.report)
    }

    @Test
    fun `job yang sudah selesai langsung menampilkan laporan tanpa berlangganan`() = runRig { r ->
        r.repo.jobs += job(status = "completed", report = REPORT)
        val vm = detailVm(r)
        runCurrent()

        assertEquals("completed", vm.ui.value.job?.status)
        assertTrue(r.ws.connections.isEmpty())
        assertFalse(vm.ui.value.loading)
    }

    @Test
    fun `gagal memuat tanpa data menampilkan error dan bisa dicoba lagi`() = runRig { r ->
        r.repo.jobs += job(status = "completed", report = REPORT)
        r.repo.failGet = IOException("mati")
        val vm = detailVm(r)
        runCurrent()
        assertNotNull(vm.ui.value.error)
        assertNull(vm.ui.value.job)

        r.repo.failGet = null
        vm.retry()
        runCurrent()
        assertNull(vm.ui.value.error)
        assertNotNull(vm.ui.value.job)
    }

    @Test
    fun `pesan kegagalan dari run ditampilkan saat job gagal`() = runRig { r ->
        r.repo.jobs += job(status = "running")
        val vm = detailVm(r)
        runCurrent()
        val conn = r.conn.also { it.open() }
        runCurrent()

        r.repo.setDetail("failed")
        conn.server(
            envelope(
                "run:rr1",
                1,
                """{"type":"error","code":"search_unavailable",""" +
                    """"message":"Mesin pencari tidak tersedia","retryable":true}"""
            )
        )
        conn.server(envelope("run:rr1", 2, status("failed")))
        runCurrent()

        assertEquals("failed", vm.ui.value.job?.status)
        assertEquals("Mesin pencari tidak tersedia", vm.ui.value.failure)
    }

    @Test
    fun `batalkan memanggil API dan memperbarui status`() = runRig { r ->
        r.repo.jobs += job(status = "running")
        val vm = detailVm(r)
        runCurrent()

        vm.cancel()
        runCurrent()

        assertEquals(listOf("j1"), r.repo.cancelled)
        assertEquals("cancelled", vm.ui.value.job?.status)
        assertFalse(vm.ui.value.cancelling)
    }

    /* ---------- ekspor dan lanjutkan di chat ---------- */

    @Test
    fun `ekspor menghasilkan berkas untuk share sheet, hanya untuk job selesai`() = runRig { r ->
        r.repo.jobs += job(status = "completed", report = REPORT)
        val events = mutableListOf<ResearchEvent>()
        val vm = detailVm(r, events)
        runCurrent()

        vm.export(ExportFormat.Pdf)
        runCurrent()

        val ready = events.filterIsInstance<ResearchEvent.ExportReady>().single()
        assertEquals("riset-x.md", ready.file.name)
        assertNull(vm.ui.value.exporting)
    }

    @Test
    fun `ekspor gagal memberi pemberitahuan dan melepas status ekspor`() = runRig { r ->
        r.repo.jobs += job(status = "completed", report = REPORT)
        r.repo.failExport = IOException("mati")
        val events = mutableListOf<ResearchEvent>()
        val vm = detailVm(r, events)
        runCurrent()

        vm.export(ExportFormat.Markdown)
        runCurrent()

        assertTrue(events.single() is ResearchEvent.Notice)
        assertNull(vm.ui.value.exporting)
    }

    @Test
    fun `lanjutkan di chat membuat percakapan baru dengan laporan sebagai pesan pertama`() = runRig { r ->
        r.repo.jobs += job(status = "completed", report = REPORT)
        val events = mutableListOf<ResearchEvent>()
        val vm = detailVm(r, events)
        runCurrent()

        vm.continueInChat()
        runCurrent()

        val open = events.filterIsInstance<ResearchEvent.OpenChat>().single()
        assertEquals("new-1", open.conversationId)
        val (conversationId, text, _) = r.chat.sendCalls.single()
        assertEquals("new-1", conversationId)
        assertEquals(continuationPrompt("Bagaimana kendaraan listrik di Asia Tenggara?", REPORT), text)
        assertTrue(text.contains("Penjualan naik 40%"))
        assertTrue(r.chat.convos.value.single().title.startsWith("Lanjutan: Bagaimana"))
    }

    @Test
    fun `lanjutkan di chat saat offline tidak membuat percakapan`() = runRig { r ->
        r.repo.jobs += job(status = "completed", report = REPORT)
        val events = mutableListOf<ResearchEvent>()
        val vm = detailVm(r, events)
        runCurrent()
        r.connectivity.state.value = false

        vm.continueInChat()
        runCurrent()

        assertEquals(0, r.chat.createCalls)
        assertTrue(events.single() is ResearchEvent.Notice)
    }

    /* ---------- daftar dan form ---------- */

    @Test
    fun `daftar dimuat dan disegarkan saat research completed masuk di channel user`() = runRig { r ->
        r.repo.jobs += job(id = "j1", status = "running")
        val vm = ResearchListViewModel(r.repo, r.realtime, r.connectivity)
        created += vm
        runCurrent()
        assertEquals(listOf("running"), vm.ui.value.items.map { it.status })
        assertFalse(vm.ui.value.loading)

        val conn = r.conn.also { it.open() }
        runCurrent()
        assertEquals(listOf("user" to 0L), conn.subscribes())

        r.repo.jobs[0] = job(id = "j1", status = "completed", report = REPORT)
        conn.server(envelope("user", 1, """{"type":"research.completed","researchId":"j1","runId":"rr1"}"""))
        runCurrent()

        assertEquals(listOf("completed"), vm.ui.value.items.map { it.status })
    }

    @Test
    fun `daftar menyegarkan sendiri tiap 10 detik selama ada job berjalan`() = runRig { r ->
        r.repo.jobs += job(id = "j1", status = "running")
        val vm = ResearchListViewModel(r.repo, r.realtime, r.connectivity)
        created += vm
        runCurrent()

        r.repo.jobs[0] = job(id = "j1", status = "completed", report = REPORT)
        advanceTimeBy(10_001)
        runCurrent()

        assertEquals("completed", vm.ui.value.items.single().status)
    }

    @Test
    fun `gagal memuat daftar kosong menampilkan error, dan halaman berikutnya ditambahkan`() = runRig { r ->
        r.repo.pages = mapOf(
            null to Page(listOf(job(id = "j9")), "j9"),
            "j9" to Page(listOf(job(id = "j5")), null)
        )
        val vm = ResearchListViewModel(r.repo, r.realtime, r.connectivity)
        created += vm
        runCurrent()
        assertEquals(listOf("j9"), vm.ui.value.items.map { it.id })

        vm.loadMore()
        runCurrent()
        assertEquals(listOf("j9", "j5"), vm.ui.value.items.map { it.id })
        assertNull(vm.ui.value.nextBefore)
    }

    @Test
    fun `form menolak pertanyaan pendek, mengirim yang sah dengan kedalaman terpilih, lalu memberi ID job`() =
        runRig { r ->
            val vm = ResearchFormViewModel(r.repo, r.connectivity)
            created += vm
            val created = mutableListOf<String>()
            backgroundScope.launch { vm.createdJob.collect { created += it } }

            vm.onQuestion("pendek")
            vm.submit()
            runCurrent()
            assertEquals(R.string.research_error_question_short, vm.ui.value.questionError)
            assertTrue(r.repo.created.isEmpty())

            vm.onQuestion("  Bagaimana prospek hidrogen hijau di Indonesia?  ")
            vm.onDepth("deep")
            vm.submit()
            runCurrent()

            assertEquals(listOf("Bagaimana prospek hidrogen hijau di Indonesia?" to "deep"), r.repo.created)
            assertEquals(listOf("new1"), created)
        }

    @Test
    fun `form offline tidak mengirim dan memberi pesan`() = runRig { r ->
        r.connectivity.state.value = false
        val vm = ResearchFormViewModel(r.repo, r.connectivity)
        created += vm
        vm.onQuestion("Pertanyaan yang cukup panjang")

        vm.submit()
        runCurrent()

        assertTrue(r.repo.created.isEmpty())
        assertEquals(R.string.error_offline, vm.ui.value.formError)
    }
}
