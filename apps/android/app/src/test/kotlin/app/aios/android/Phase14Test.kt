package app.aios.android

import android.speech.SpeechRecognizer
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.api.CreateScheduleRequest
import app.aios.android.data.api.DevicesApi
import app.aios.android.data.api.Page
import app.aios.android.data.api.PushTokenRequest
import app.aios.android.data.api.Run
import app.aios.android.data.api.Schedule
import app.aios.android.data.api.ScheduleParse
import app.aios.android.data.api.ScheduleRun
import app.aios.android.data.auth.AuthRepository
import app.aios.android.data.realtime.Backoff
import app.aios.android.data.realtime.Frame
import app.aios.android.data.realtime.Frames
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.data.schedules.ScheduleRepository
import app.aios.android.link.AppLink
import app.aios.android.link.AppLinks
import app.aios.android.push.NotificationChannels
import app.aios.android.push.PushRegistrar
import app.aios.android.push.PushTokenSource
import app.aios.android.push.RegistrationStore
import app.aios.android.ui.chat.VoiceError
import app.aios.android.ui.chat.appendTranscript
import app.aios.android.ui.chat.voiceErrorFor
import app.aios.android.ui.schedules.ScheduleCreateViewModel
import app.aios.android.ui.schedules.ScheduleDetailViewModel
import app.aios.android.ui.schedules.ScheduleEvent
import app.aios.android.ui.schedules.ScheduleFormat
import app.aios.android.ui.schedules.ScheduleListViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
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
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/* ---------- tautan dari notifikasi dan share ---------- */

class AppLinksTest {
    @Test
    fun `notifikasi riset membuka layar riset`() {
        val link = AppLinks.fromPush(mapOf("type" to "research.completed", "researchId" to "r1", "runId" to "x"))
        assertEquals(AppLink.OpenResearch("r1"), link)
    }

    @Test
    fun `notifikasi jadwal membuka percakapan hasilnya, atau jadwalnya bila percakapan tidak ada`() {
        val withConversation = mapOf(
            "type" to "schedule.result",
            "scheduleId" to "s1",
            "conversationId" to "c1",
            "status" to "succeeded",
        )
        assertEquals(AppLink.OpenConversation("c1"), AppLinks.fromPush(withConversation))
        assertEquals(AppLink.OpenSchedule("s1"), AppLinks.fromPush(withConversation - "conversationId"))
        assertEquals(AppLink.OpenSchedule("s1"), AppLinks.fromPush(withConversation + ("conversationId" to " ")))
    }

    @Test
    fun `jenis tak dikenal, tes, atau ID kosong tidak membuka apa-apa`() {
        assertNull(AppLinks.fromPush(mapOf("type" to "test")))
        assertNull(AppLinks.fromPush(mapOf("type" to "research.completed")))
        assertNull(AppLinks.fromPush(mapOf("type" to "research.completed", "researchId" to "")))
        assertNull(AppLinks.fromPush(emptyMap()))
        assertNull(AppLinks.fromPush(mapOf("type" to null)))
    }

    @Test
    fun `share teks dan URL, judul halaman ikut bila belum ada di teks`() {
        assertEquals(AppLink.SharedText("halo"), AppLinks.fromShare(null, "  halo  "))
        assertEquals(
            AppLink.SharedText("Judul Berita\nhttps://contoh.com/a"),
            AppLinks.fromShare("Judul Berita", "https://contoh.com/a"),
        )
        assertEquals(
            AppLink.SharedText("Judul Berita - https://contoh.com/a"),
            AppLinks.fromShare("Judul Berita", "Judul Berita - https://contoh.com/a"),
        )
        assertEquals(AppLink.SharedText("hanya judul"), AppLinks.fromShare("hanya judul", null))
    }

    @Test
    fun `share kosong diabaikan dan teks sangat panjang dipotong`() {
        assertNull(AppLinks.fromShare(null, "   "))
        assertNull(AppLinks.fromShare("", null))
        val long = AppLinks.fromShare(null, "x".repeat(50_000)) as AppLink.SharedText
        assertEquals(20_000, long.text.length)
    }

    @Test
    fun `kanal notifikasi sama dengan yang dipilih gateway`() {
        assertEquals("riset", NotificationChannels.forType("research.completed"))
        assertEquals("jadwal", NotificationChannels.forType("schedule.result"))
        assertEquals("umum", NotificationChannels.forType("test"))
        assertEquals("umum", NotificationChannels.forType(null))
    }
}

/* ---------- suara ---------- */

class VoiceTextTest {
    @Test
    fun `transkrip disambung ke teks yang sudah ada tanpa menimpanya`() {
        assertEquals("halo dunia", appendTranscript("", " halo dunia "))
        assertEquals("tolong ringkas ini", appendTranscript("tolong", "ringkas ini"))
        assertEquals("tolong ringkas", appendTranscript("tolong  ", "ringkas"))
        assertEquals("tetap", appendTranscript("tetap", "   "))
    }

    @Test
    fun `kode error pengenal suara dipetakan ke jenis yang dipahami UI`() {
        assertEquals(VoiceError.NoSpeech, voiceErrorFor(SpeechRecognizer.ERROR_NO_MATCH))
        assertEquals(VoiceError.NoSpeech, voiceErrorFor(SpeechRecognizer.ERROR_SPEECH_TIMEOUT))
        assertEquals(VoiceError.PermissionDenied, voiceErrorFor(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS))
        assertEquals(VoiceError.Failed, voiceErrorFor(SpeechRecognizer.ERROR_NETWORK))
        assertEquals(VoiceError.Failed, voiceErrorFor(SpeechRecognizer.ERROR_AUDIO))
    }
}

/* ---------- format waktu jadwal dan event ---------- */

class ScheduleFormatTest {
    @Test
    fun `waktu ditampilkan di zona waktu jadwalnya dengan label`() {
        assertEquals("Sen, 26 Okt 07.00 WIB", ScheduleFormat.instant("2026-10-26T00:00:00.000Z", "Asia/Jakarta"))
        assertEquals("Sen, 26 Okt 07.00 WITA", ScheduleFormat.instant("2026-10-25T23:00:00.000Z", "Asia/Makassar"))
        assertEquals("Sen, 26 Okt 08.05 WIT", ScheduleFormat.instant("2026-10-25T23:05:00.000Z", "Asia/Jayapura"))
        assertEquals("Min, 1 Nov 00.30 Europe/Paris", ScheduleFormat.instant("2026-10-31T23:30:00.000Z", "Europe/Paris"))
    }

    @Test
    fun `nilai kosong atau rusak menghasilkan null, bukan crash`() {
        assertNull(ScheduleFormat.instant(null, "Asia/Jakarta"))
        assertNull(ScheduleFormat.instant("bukan tanggal", "Asia/Jakarta"))
        assertNull(ScheduleFormat.instant("2026-10-26T00:00:00.000Z", "Mars/Olympus"))
    }

    @Test
    fun `event schedule result diurai dari channel user`() {
        val frame = Frames.parse(
            envelope(
                "user",
                3,
                """{"type":"schedule.result","scheduleId":"s1","scheduleRunId":"sr1","runId":null,"status":"failed"}""",
            ),
            testJson,
        ) as Frame.Envelope
        assertEquals(ServerEvent.ScheduleResult("s1", "failed"), frame.event)
    }
}

/* ---------- pendaftaran token push ---------- */

private class FakeRegistrationStore(var value: String? = null) : RegistrationStore {
    override suspend fun registeredPush() = value

    override suspend fun setRegisteredPush(value: String) {
        this.value = value
    }
}

private class FakeTokenSource(var token: String? = "fcm-1", override val available: Boolean = true) : PushTokenSource {
    override suspend fun token() = token
}

private class FakeDevicesApi : DevicesApi {
    val calls = mutableListOf<Pair<String, String>>()
    var status = 204
    var failure: Exception? = null

    override suspend fun setPushToken(id: String, body: PushTokenRequest): Response<Unit> {
        calls += id to body.pushToken
        failure?.let { throw it }
        return if (status in 200..299) {
            Response.success(Unit)
        } else {
            Response.error(status, "{}".toResponseBody("application/json".toMediaType()))
        }
    }
}

class PushRegistrarTest {
    private val api = FakeDevicesApi()
    private val store = FakeRegistrationStore()
    private val source = FakeTokenSource()
    private val registrar = PushRegistrar(source, api, store)

    @Test
    fun `token baru didaftarkan sekali, sinkron berikutnya dilewati`() = runBlocking {
        registrar.sync("d1")
        registrar.sync("d1")

        assertEquals(listOf("d1" to "fcm-1"), api.calls)
        assertEquals("d1|fcm-1", store.value)
    }

    @Test
    fun `login sebagai perangkat lain dengan token yang sama tetap mendaftar`() = runBlocking {
        registrar.sync("d1")
        registrar.sync("d2")

        assertEquals(listOf("d1" to "fcm-1", "d2" to "fcm-1"), api.calls)
    }

    @Test
    fun `token berganti dari FCM didaftarkan ulang`() = runBlocking {
        registrar.sync("d1")
        registrar.onNewToken("d1", "fcm-2")

        assertEquals(listOf("d1" to "fcm-1", "d1" to "fcm-2"), api.calls)
    }

    @Test
    fun `gagal mendaftar tidak dianggap terdaftar dan dicoba lagi berikutnya`() = runBlocking {
        api.status = 500
        registrar.sync("d1")
        assertNull(store.value)

        api.failure = IOException("mati")
        registrar.sync("d1")
        assertNull(store.value)

        api.status = 204
        api.failure = null
        registrar.sync("d1")
        assertEquals("d1|fcm-1", store.value)
        assertEquals(3, api.calls.size)
    }

    @Test
    fun `tanpa token (Firebase tidak dikonfigurasi) atau tanpa perangkat tidak memanggil server`() = runBlocking {
        source.token = null
        registrar.sync("d1")
        registrar.onNewToken(null, "fcm-9")

        assertTrue(api.calls.isEmpty())
        assertFalse(FakeTokenSource(available = false).available)
    }

    @Test
    fun `login membawa token push di request dan memberi tahu perangkat yang terdaftar`() = runBlocking {
        val server = MockWebServer().also { it.start() }
        try {
            server.enqueue(
                MockResponse().setBody(
                    """{"accessToken":"a","refreshToken":"r","expiresIn":900,"device":{"id":"dev-9","kind":"android",""" +
                        """"name":"HP","scopes":["app"],"lastSeenAt":null,"createdAt":"$TS"}}""",
                ),
            )
            val store = FakeTokenStore(null)
            val http = TestHttp(server, store)
            val registered = mutableListOf<Pair<String, String>>()
            val repo = AuthRepository(
                store = store,
                publicApi = http.publicApi,
                sessionApi = http.sessionApi,
                endpoint = http.endpoint,
                events = http.events,
                deviceName = "HP",
                allowCleartextLocal = true,
                isConnected = { true },
                clock = { NOW_MS },
                pushToken = { "fcm-login" },
                onPushRegistered = { device, token -> registered += device to token },
            )

            repo.login(server.url("/").toString().trimEnd('/'), "rahasia-panjang", "123456")

            assertTrue(server.takeRequest().body.readUtf8().contains(""""pushToken":"fcm-login""""))
            assertEquals(listOf("dev-9" to "fcm-login"), registered)
        } finally {
            server.shutdown()
        }
    }
}

/* ---------- ViewModel jadwal ---------- */

fun schedule(
    id: String = "s1",
    enabled: Boolean = true,
    name: String = "Berita AI",
    prompt: String = "Ringkas berita AI.",
    conversationId: String? = "cs1",
) = Schedule(
    id, name, "0 7 * * 1", "Asia/Jakarta", prompt, "chat", null, enabled,
    "2026-10-26T00:00:00.000Z", conversationId, TS, TS,
)

fun parsed() = ScheduleParse(
    "Berita AI", "0 7 * * 1", "Asia/Jakarta", "Ringkas berita AI.", "chat", null,
    "Setiap Senin 07.00 WIB",
    listOf("2026-10-26T00:00:00.000Z", "2026-11-02T00:00:00.000Z", "2026-11-09T00:00:00.000Z"),
)

private class FakeScheduleRepo : ScheduleRepository {
    var items = mutableListOf<Schedule>()
    var runsBySchedule = mutableMapOf<String, List<ScheduleRun>>()
    var parseResult: ScheduleParse? = parsed()
    var failure: Exception? = null
    var updateFailure: Exception? = null
    var runNowFailure: Exception? = null
    val created = mutableListOf<CreateScheduleRequest>()
    val updates = mutableListOf<Triple<String?, String?, Boolean?>>()
    val runNowCalls = mutableListOf<String>()
    val deleted = mutableListOf<String>()
    var listCalls = 0

    override suspend fun list(): List<Schedule> {
        listCalls++
        failure?.let { throw it }
        return items.toList()
    }

    override suspend fun parse(text: String, timezone: String): ScheduleParse {
        failure?.let { throw it }
        return parseResult ?: throw httpError(422, "schedule_unparseable", "Itu jadwal sekali jalan.")
    }

    override suspend fun create(draft: ScheduleParse, name: String, prompt: String): Schedule {
        created += CreateScheduleRequest(name.trim(), draft.cron, draft.timezone, prompt.trim(), draft.target)
        return schedule(id = "baru", name = name.trim(), prompt = prompt.trim()).also { items += it }
    }

    override suspend fun update(id: String, name: String?, prompt: String?, enabled: Boolean?): Schedule {
        updateFailure?.let { throw it }
        updates += Triple(name, prompt, enabled)
        val current = items.first { it.id == id }
        val next = current.copy(
            name = name?.trim() ?: current.name,
            prompt = prompt?.trim() ?: current.prompt,
            enabled = enabled ?: current.enabled,
        )
        items[items.indexOf(current)] = next
        return next
    }

    override suspend fun delete(id: String) {
        deleted += id
        items.removeAll { it.id == id }
    }

    override suspend fun runNow(id: String): Run {
        runNowCalls += id
        runNowFailure?.let { throw it }
        return run("rr", "queued")
    }

    override suspend fun runs(id: String, before: String?): Page<ScheduleRun> =
        Page(runsBySchedule[id].orEmpty(), null)

    override suspend fun lastRuns(schedules: List<Schedule>): Map<String, ScheduleRun> =
        schedules.mapNotNull { s -> runsBySchedule[s.id]?.firstOrNull()?.let { s.id to it } }.toMap()
}

private fun httpError(status: Int, code: String, detail: String) = HttpException(
    Response.error<Unit>(
        status,
        """{"type":"t","title":"t","status":$status,"detail":"$detail","code":"$code"}"""
            .toResponseBody("application/problem+json".toMediaType()),
    ),
)

private fun scheduleRun(status: String, id: String = "sr1") = ScheduleRun(id, "s1", "rr", status, TS, TS)

@OptIn(ExperimentalCoroutinesApi::class)
class ScheduleViewModelsTest {
    @get:Rule
    val timeout: Timeout = Timeout.seconds(30)

    private val scheduler = TestCoroutineScheduler()
    private val dispatcher = StandardTestDispatcher(scheduler)

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class Rig(scope: TestScope) {
        val repo = FakeScheduleRepo()
        val ws = FakeWsTransport().also { it.clock = { scope.currentTime } }
        val connectivity = FakeConnectivity()
        val realtime = RealtimeClient(scope.backgroundScope, ws, FakeTokens(), Backoff(), lingerMs = 60_000)
        val created = mutableListOf<ViewModel>()
        val events = mutableListOf<ScheduleEvent>()

        fun <T : ViewModel> track(vm: T) = vm.also { created += it }

        fun close() = created.forEach { it.viewModelScope.cancel() }
    }

    private fun rigTest(block: suspend TestScope.(Rig) -> Unit) = runTest(dispatcher) {
        val rig = Rig(this)
        try {
            block(rig)
        } finally {
            rig.close()
        }
    }

    private fun TestScope.listVm(r: Rig) = r.track(ScheduleListViewModel(r.repo, r.realtime, r.connectivity)).also { vm ->
        backgroundScope.launch { vm.events.collect { r.events += it } }
    }

    private fun TestScope.createVm(r: Rig) = r.track(ScheduleCreateViewModel(r.repo, r.connectivity)).also { vm ->
        backgroundScope.launch { vm.events.collect { r.events += it } }
    }

    private fun TestScope.detailVm(r: Rig, id: String = "s1") = r.track(
        ScheduleDetailViewModel(SavedStateHandle(mapOf("id" to id)), r.repo, r.realtime, r.connectivity),
    ).also { vm -> backgroundScope.launch { vm.events.collect { r.events += it } } }

    /* daftar */

    @Test
    fun `daftar memuat jadwal beserta hasil terakhir tiap jadwal`() = rigTest { r ->
        r.repo.items += listOf(schedule("s1"), schedule("s2", enabled = false))
        r.repo.runsBySchedule["s1"] = listOf(scheduleRun("succeeded"))
        val vm = listVm(r)
        runCurrent()

        assertEquals(listOf("s1", "s2"), vm.ui.value.items.map { it.id })
        assertEquals("succeeded", vm.ui.value.lastRuns["s1"]?.status)
        assertNull(vm.ui.value.lastRuns["s2"])
        assertFalse(vm.ui.value.loading)
    }

    @Test
    fun `daftar kosong dan gagal memuat`() = rigTest { r ->
        val empty = listVm(r)
        runCurrent()
        assertTrue(empty.ui.value.items.isEmpty())
        assertNull(empty.ui.value.error)

        r.repo.failure = IOException("mati")
        val failing = listVm(r)
        runCurrent()
        assertNotNull(failing.ui.value.error)
        assertFalse(failing.ui.value.loading)
    }

    @Test
    fun `toggle langsung terlihat lalu cocok dengan server, dan dikembalikan bila ditolak`() = rigTest { r ->
        r.repo.items += schedule("s1", enabled = true)
        val vm = listVm(r)
        runCurrent()

        vm.setEnabled(vm.ui.value.items.single(), false)
        assertFalse(vm.ui.value.items.single().enabled)
        runCurrent()
        assertFalse(vm.ui.value.items.single().enabled)
        assertEquals(Triple(null, null, false), r.repo.updates.single())

        r.repo.updateFailure = IOException("mati")
        vm.setEnabled(vm.ui.value.items.single(), true)
        runCurrent()
        assertFalse("kembali ke nilai awal", vm.ui.value.items.single().enabled)
        assertTrue(r.events.single() is ScheduleEvent.Notice)
    }

    @Test
    fun `hasil run baru di channel user menyegarkan daftar`() = rigTest { r ->
        r.repo.items += schedule("s1")
        val vm = listVm(r)
        runCurrent()
        val conn = r.ws.connections.last().also { it.open() }
        runCurrent()
        assertEquals(listOf("user" to 0L), conn.subscribes())

        r.repo.runsBySchedule["s1"] = listOf(scheduleRun("failed"))
        conn.server(
            envelope(
                "user",
                1,
                """{"type":"schedule.result","scheduleId":"s1","scheduleRunId":"sr1","runId":null,"status":"failed"}""",
            ),
        )
        runCurrent()

        assertEquals("failed", vm.ui.value.lastRuns["s1"]?.status)
    }

    /* buat */

    @Test
    fun `kalimat pendek ditolak lokal, offline tidak memanggil server`() = rigTest { r ->
        val vm = createVm(r)
        vm.onText("abc")
        vm.parse()
        runCurrent()
        assertEquals(R.string.schedule_error_text_short, vm.ui.value.textError)
        assertNull(vm.ui.value.draft)

        r.connectivity.state.value = false
        vm.onText("setiap hari jam 7 pagi")
        vm.parse()
        runCurrent()
        assertEquals(R.string.error_offline, vm.ui.value.formError)
        assertNull(vm.ui.value.draft)
    }

    @Test
    fun `parse berhasil menampilkan pratinjau yang bisa diedit, lalu simpan mengirim hasil editan`() = rigTest { r ->
        val vm = createVm(r)
        vm.onText("setiap Senin jam 7 pagi ringkas berita AI")
        vm.parse()
        runCurrent()

        val draft = vm.ui.value.draft!!
        assertEquals("Setiap Senin 07.00 WIB", draft.description)
        assertEquals(3, draft.nextRuns.size)
        assertEquals("Berita AI", vm.ui.value.name)

        vm.onName("  Berita AI Senin ")
        vm.onPrompt("Ringkas 5 berita AI terpenting.")
        vm.save()
        runCurrent()

        val request = r.repo.created.single()
        assertEquals("Berita AI Senin", request.name)
        assertEquals("Ringkas 5 berita AI terpenting.", request.prompt)
        assertEquals("0 7 * * 1", request.cron)
        assertEquals(ScheduleEvent.Created("baru"), r.events.single())
        assertNull(vm.ui.value.draft)
        assertEquals("", vm.ui.value.text)
    }

    @Test
    fun `kalimat yang bukan jadwal berulang menampilkan penjelasan server dan tidak menyimpan apa pun`() = rigTest { r ->
        r.repo.parseResult = null
        val vm = createVm(r)
        vm.onText("besok jam 7 ingatkan rapat")
        vm.parse()
        runCurrent()

        assertEquals("Itu jadwal sekali jalan.", vm.ui.value.serverMessage)
        assertNotNull(vm.ui.value.formError)
        assertNull(vm.ui.value.draft)
        assertTrue(r.repo.created.isEmpty())
    }

    @Test
    fun `nama kosong ditolak saat simpan, dan ubah kalimat membuang pratinjau`() = rigTest { r ->
        val vm = createVm(r)
        vm.onText("setiap hari jam 6 pagi")
        vm.parse()
        runCurrent()

        vm.onName("  ")
        vm.save()
        runCurrent()
        assertEquals(R.string.schedule_error_fields, vm.ui.value.formError)
        assertTrue(r.repo.created.isEmpty())

        vm.editText()
        assertNull(vm.ui.value.draft)
        assertEquals("setiap hari jam 6 pagi", vm.ui.value.text)
    }

    /* detail */

    @Test
    fun `detail memuat jadwal dan riwayat terbaru dulu`() = rigTest { r ->
        r.repo.items += schedule("s1")
        r.repo.runsBySchedule["s1"] = listOf(scheduleRun("failed", "sr2"), scheduleRun("succeeded", "sr1"))
        val vm = detailVm(r)
        runCurrent()

        assertEquals("Berita AI", vm.ui.value.schedule?.name)
        assertEquals(listOf("sr2", "sr1"), vm.ui.value.runs.map { it.id })
        assertEquals("Berita AI", vm.ui.value.editName)
    }

    @Test
    fun `jadwal yang sudah tidak ada menutup layar`() = rigTest { r ->
        detailVm(r, id = "hilang")
        runCurrent()

        assertEquals(ScheduleEvent.Deleted, r.events.single())
    }

    @Test
    fun `jalankan sekarang memanggil server, dan 409 dijelaskan sebagai masih berjalan`() = rigTest { r ->
        r.repo.items += schedule("s1")
        val vm = detailVm(r)
        runCurrent()

        vm.runNow()
        runCurrent()
        assertEquals(listOf("s1"), r.repo.runNowCalls)
        assertTrue(r.events.contains(ScheduleEvent.RunStarted))
        assertFalse(vm.ui.value.runningNow)

        r.repo.runNowFailure = httpError(409, "schedule_run_in_progress", "Masih berjalan.")
        vm.runNow()
        runCurrent()
        assertEquals(ScheduleEvent.Notice(R.string.schedule_error_running), r.events.last())
    }

    @Test
    fun `simpan perubahan hanya bila nama atau perintah berubah`() = rigTest { r ->
        r.repo.items += schedule("s1")
        val vm = detailVm(r)
        runCurrent()

        vm.saveEdits()
        runCurrent()
        assertTrue("tidak ada perubahan, tidak ada panggilan", r.repo.updates.isEmpty())

        vm.onPrompt("Ringkas berita AI dan kripto.")
        vm.saveEdits()
        runCurrent()
        assertEquals(Triple("Berita AI", "Ringkas berita AI dan kripto.", null), r.repo.updates.single())
        assertEquals("Ringkas berita AI dan kripto.", vm.ui.value.schedule?.prompt)
        assertEquals(ScheduleEvent.Notice(R.string.schedule_saved), r.events.last())
    }

    @Test
    fun `toggle di detail dan hapus`() = rigTest { r ->
        r.repo.items += schedule("s1")
        val vm = detailVm(r)
        runCurrent()

        vm.setEnabled(false)
        runCurrent()
        assertFalse(vm.ui.value.schedule!!.enabled)

        vm.delete()
        runCurrent()
        assertEquals(listOf("s1"), r.repo.deleted)
        assertEquals(ScheduleEvent.Deleted, r.events.last())
    }
}
