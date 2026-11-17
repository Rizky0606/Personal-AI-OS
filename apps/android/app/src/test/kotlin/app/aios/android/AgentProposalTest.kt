package app.aios.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.api.AgentProposal
import app.aios.android.data.api.AgentProposalApi
import app.aios.android.data.api.AgentProposalList
import app.aios.android.data.api.AgentProposalSchedule
import app.aios.android.data.api.AgentProposalTask
import app.aios.android.data.api.ApproveAgentProposalRequest
import app.aios.android.data.api.SCHEDULE_PROPOSAL_NAME_MAX
import app.aios.android.data.api.SCHEDULE_PROPOSAL_PROMPT_MAX
import app.aios.android.data.api.TASK_PROPOSAL_BODY_MAX
import app.aios.android.data.api.TASK_PROPOSAL_TITLE_MAX
import app.aios.android.data.proposals.AgentProposalEdits
import app.aios.android.data.proposals.AgentProposalRepository
import app.aios.android.data.proposals.RemoteAgentProposalRepository
import app.aios.android.data.realtime.Backoff
import app.aios.android.data.realtime.Frame
import app.aios.android.data.realtime.Frames
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.ui.proposals.AgentProposalEvent
import app.aios.android.ui.proposals.AgentProposalViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/*
 * Bentuk mengikuti AgentProposalSchema di packages/contracts; `extra` dan `hint` adalah kolom baru yang belum
 * dikenal.
 */
private const val TASK_JSON = """
{"id":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e01","kind":"task","status":"pending","agent":"omp",
"reason":"Bug login muncul tiga kali minggu ini.","afterWeb":false,
"projectId":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e02","conversationId":null,"runId":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e03",
"resultId":null,"createdAt":"2026-11-16T01:00:00.000Z","decidedAt":null,
"task":{"title":"Perbaiki login","body":"Token kedaluwarsa tidak disegarkan.","hint":"x"},"extra":{"a":1}}
"""

private const val SCHEDULE_JSON = """
{"id":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e04","kind":"schedule","status":"pending","agent":"hermes",
"reason":"Kamu minta ringkasan berita tiap Senin.","afterWeb":true,"projectId":null,
"conversationId":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e05","runId":null,"resultId":null,
"createdAt":"2026-11-16T02:00:00.000Z","decidedAt":null,
"schedule":{"name":"Berita Senin","cron":"0 7 * * 1","timezone":"Asia/Jakarta","prompt":"Ringkas berita teknologi.","target":"research"},
"description":"Setiap Senin 07.00 WIB","extra":"abaikan"}
"""

private const val DECIDED_409 = """
{"type":"urn:aios:problem:proposal_decided","title":"Konflik dengan status saat ini","status":409,"detail":"Usulan sudah diputuskan.","code":"proposal_decided"}
"""

private const val INVALID_CRON_400 = """
{"type":"urn:aios:problem:invalid_cron","title":"Isian tidak valid","status":400,"detail":"Cron tidak valid.","code":"invalid_cron"}
"""

private fun proposal(id: String, kind: String = "task") = AgentProposal(
    id = id,
    kind = kind,
    status = "pending",
    agent = "omp",
    reason = "alasan $id",
    createdAt = TS,
    task = if (kind == "task") AgentProposalTask("kartu $id", "isi") else null,
    schedule = if (kind == "schedule") {
        AgentProposalSchedule("jadwal $id", "0 7 * * 1", "Asia/Jakarta", "Ringkas berita.", "chat")
    } else {
        null
    }
)

private class FakeAgentProposalRepo : AgentProposalRepository {
    val items = mutableListOf<AgentProposal>()
    var listCalls = 0
    var failNext: Exception? = null
    val approved = mutableListOf<String>()
    val editsSent = mutableListOf<AgentProposalEdits?>()
    val rejected = mutableListOf<String>()

    private fun maybeFail() {
        failNext?.let {
            failNext = null
            throw it
        }
    }

    override suspend fun pending(): List<AgentProposal> {
        listCalls++
        maybeFail()
        return items.toList()
    }

    override suspend fun approve(proposal: AgentProposal, edits: AgentProposalEdits?): AgentProposal {
        maybeFail()
        approved += proposal.id
        editsSent += edits
        items.removeAll { it.id == proposal.id }
        return proposal.copy(status = "approved", resultId = "hasil-${proposal.id}")
    }

    override suspend fun reject(id: String): AgentProposal {
        maybeFail()
        rejected += id
        val target = items.first { it.id == id }
        items.remove(target)
        return target.copy(status = "rejected")
    }
}

private class FakeAgentProposalApi : AgentProposalApi {
    val bodies = mutableListOf<ApproveAgentProposalRequest>()

    override suspend fun list(status: String?, kind: String?) = AgentProposalList(emptyList())

    override suspend fun approve(id: String, body: ApproveAgentProposalRequest): AgentProposal {
        bodies += body
        return proposal(id).copy(status = "approved")
    }

    override suspend fun reject(id: String) = proposal(id).copy(status = "rejected")
}

private fun problem(code: Int, body: String) = HttpException(
    Response.error<Unit>(code, body.toResponseBody("application/problem+json".toMediaType()))
)

class AgentProposalModelsTest {
    @Test
    fun `usulan kartu terbaca, kolom tak dikenal diabaikan`() {
        val p = testJson.decodeFromString(AgentProposal.serializer(), TASK_JSON)
        assertEquals("task", p.kind)
        assertEquals("Perbaiki login", p.task?.title)
        assertEquals("Token kedaluwarsa tidak disegarkan.", p.task?.body)
        assertNull(p.schedule)
        assertNull(p.description)
        assertNull(p.conversationId)
        assertFalse(p.afterWeb)
        assertEquals("omp", p.agent)
    }

    @Test
    fun `usulan jadwal terbaca beserta deskripsi dan tanda afterWeb`() {
        val p = testJson.decodeFromString(AgentProposal.serializer(), SCHEDULE_JSON)
        assertEquals("schedule", p.kind)
        assertNull(p.task)
        assertEquals("Berita Senin", p.schedule?.name)
        assertEquals("0 7 * * 1", p.schedule?.cron)
        assertEquals("research", p.schedule?.target)
        assertEquals("Setiap Senin 07.00 WIB", p.description)
        assertTrue(p.afterWeb)
        assertNull(p.projectId)
    }

    @Test
    fun `daftar dua jenis terbaca`() {
        val list = testJson.decodeFromString(
            AgentProposalList.serializer(),
            """{"items":[$TASK_JSON,$SCHEDULE_JSON]}"""
        )
        assertEquals(listOf("task", "schedule"), list.items.map { it.kind })
    }

    @Test
    fun `setujui kartu mengirim body kosong, jadwal mengirim enabled true`() = runBlocking {
        val api = FakeAgentProposalApi()
        val repo = RemoteAgentProposalRepository(api)
        repo.approve(proposal("t1"))
        repo.approve(proposal("s1", kind = "schedule"))
        val encoded = api.bodies.map { testJson.encodeToString(ApproveAgentProposalRequest.serializer(), it) }
        assertEquals(listOf("{}", """{"schedule":{"enabled":true}}"""), encoded)
    }

    @Test
    fun `setujui kartu yang disunting mengirim ubahan task`() = runBlocking {
        val api = FakeAgentProposalApi()
        RemoteAgentProposalRepository(api).approve(
            proposal("t1"),
            AgentProposalEdits(title = "Judul baru", body = "Isi baru")
        )
        assertEquals(
            """{"task":{"title":"Judul baru","body":"Isi baru"}}""",
            testJson.encodeToString(ApproveAgentProposalRequest.serializer(), api.bodies.single())
        )
    }

    @Test
    fun `setujui jadwal yang disunting mengirim ubahan schedule beserta enabled`() = runBlocking {
        val api = FakeAgentProposalApi()
        RemoteAgentProposalRepository(api).approve(
            proposal("s1", kind = "schedule"),
            AgentProposalEdits(
                name = "Berita pagi",
                cron = "0 6 * * 1",
                timezone = "Asia/Makassar",
                prompt = "Ringkas berita.",
                enabled = false
            )
        )
        assertEquals(
            """{"schedule":{"name":"Berita pagi","cron":"0 6 * * 1","timezone":"Asia/Makassar",""" +
                """"prompt":"Ringkas berita.","enabled":false}}""",
            testJson.encodeToString(ApproveAgentProposalRequest.serializer(), api.bodies.single())
        )
    }

    @Test
    fun `notifikasi channel user terurai beserta topiknya, topik absen jadi null`() {
        val withTopic = Frames.parse(
            envelope(
                "user",
                4,
                """{"type":"notification","title":"Usulan baru","level":"info","topic":"agent_proposal"}"""
            ),
            testJson
        ) as Frame.Envelope
        assertEquals(ServerEvent.Notification("agent_proposal"), withTopic.event)

        val plain = Frames.parse(
            envelope("user", 5, """{"type":"notification","title":"Halo","level":"info"}"""),
            testJson
        ) as Frame.Envelope
        assertEquals(ServerEvent.Notification(null), plain.event)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class AgentProposalViewModelTest {
    private val dispatcher = StandardTestDispatcher(TestCoroutineScheduler())
    private val repo = FakeAgentProposalRepo()
    private val connectivity = FakeConnectivity()
    private val ws = FakeWsTransport()
    private val created = mutableListOf<ViewModel>()
    private val events = mutableListOf<AgentProposalEvent>()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() {
        created.forEach { it.viewModelScope.cancel() }
        Dispatchers.resetMain()
    }

    private fun TestScope.vm(): AgentProposalViewModel {
        val realtime = RealtimeClient(backgroundScope, ws, FakeTokens(), Backoff(), lingerMs = 60_000)
        return AgentProposalViewModel(repo, realtime, connectivity).also { vm ->
            created += vm
            backgroundScope.launch { vm.events.collect { events += it } }
        }
    }

    private fun notices() = events.filterIsInstance<AgentProposalEvent.Notice>().map { it.message }

    @Test
    fun `memuat usulan, kosong, dan gagal saat offline menampilkan galat`() = runTest(dispatcher) {
        repo.items += listOf(proposal("a"), proposal("b", kind = "schedule"))
        val loaded = vm()
        runCurrent()
        assertEquals(listOf("a", "b"), loaded.ui.value.items.map { it.id })
        assertFalse(loaded.ui.value.loading)
        assertNull(loaded.ui.value.error)

        repo.items.clear()
        val empty = vm()
        runCurrent()
        assertTrue(empty.ui.value.items.isEmpty())
        assertNull(empty.ui.value.error)

        repo.failNext = IOException("putus")
        connectivity.state.value = false
        val failed = vm()
        runCurrent()
        assertNotNull(failed.ui.value.error)
        assertEquals(R.string.error_offline, failed.ui.value.error?.messageRes)
    }

    @Test
    fun `setujui kartu dan jadwal menghapusnya dari daftar dengan pesan masing-masing`() = runTest(dispatcher) {
        repo.items += listOf(proposal("t1"), proposal("s1", kind = "schedule"))
        val vm = vm()
        runCurrent()
        vm.approve(vm.ui.value.items.first { it.id == "t1" })
        runCurrent()
        vm.approve(vm.ui.value.items.single())
        runCurrent()
        assertTrue(vm.ui.value.items.isEmpty())
        assertNull(vm.ui.value.deciding)
        assertEquals(listOf("t1", "s1"), repo.approved)
        assertEquals(
            listOf(R.string.agent_proposal_approved_task, R.string.agent_proposal_approved_schedule),
            notices()
        )
    }

    @Test
    fun `tolak menghapus usulan dari daftar`() = runTest(dispatcher) {
        repo.items += proposal("t1")
        val vm = vm()
        runCurrent()
        vm.reject(vm.ui.value.items.single())
        runCurrent()
        assertTrue(vm.ui.value.items.isEmpty())
        assertEquals(listOf("t1"), repo.rejected)
        assertEquals(listOf(R.string.agent_proposal_rejected), notices())
    }

    @Test
    fun `409 sudah diputuskan memberi pesan khusus dan memuat ulang daftar`() = runTest(dispatcher) {
        repo.items += proposal("t1")
        val vm = vm()
        runCurrent()
        val before = repo.listCalls
        repo.items.clear()
        repo.failNext = problem(409, DECIDED_409)
        vm.approve(proposal("t1"))
        runCurrent()
        assertEquals(listOf(R.string.agent_proposal_decided), notices())
        assertEquals(before + 1, repo.listCalls)
        assertTrue(vm.ui.value.items.isEmpty())
        assertNull(vm.ui.value.deciding)
    }

    @Test
    fun `gagal jaringan saat menyetujui memberi snackbar dan usulan tetap ada`() = runTest(dispatcher) {
        repo.items += proposal("t1")
        val vm = vm()
        runCurrent()
        repo.failNext = IOException("putus")
        vm.approve(vm.ui.value.items.single())
        runCurrent()
        assertEquals(listOf("t1"), vm.ui.value.items.map { it.id })
        assertEquals(1, notices().size)
        assertTrue(notices().single() != R.string.agent_proposal_decided)
    }

    @Test
    fun `notifikasi agent_proposal di channel user menyegarkan daftar, topik lain tidak`() = runTest(dispatcher) {
        val vm = vm()
        runCurrent()
        val conn = ws.connections.last().also { it.open() }
        runCurrent()
        assertEquals(listOf("user" to 0L), conn.subscribes())

        repo.items += proposal("baru")
        conn.server(
            envelope("user", 1, """{"type":"notification","title":"x","level":"info","topic":"memory_proposal"}""")
        )
        runCurrent()
        assertTrue(vm.ui.value.items.isEmpty())

        conn.server(
            envelope("user", 2, """{"type":"notification","title":"x","level":"info","topic":"agent_proposal"}""")
        )
        runCurrent()
        assertEquals(listOf("baru"), vm.ui.value.items.map { it.id })
    }

    @Test
    fun `ubah lalu setujui kartu mengirim judul dan isi hasil suntingan`() = runTest(dispatcher) {
        repo.items += proposal("t1")
        val vm = vm()
        runCurrent()
        vm.startEdit(vm.ui.value.items.single())
        assertEquals("kartu t1", vm.ui.value.edit.title)
        vm.onTitleChange("  Judul baru  ")
        vm.onBodyChange("Isi baru")
        vm.approveEdited()
        runCurrent()
        assertEquals(listOf(AgentProposalEdits(title = "Judul baru", body = "Isi baru")), repo.editsSent)
        assertNull(vm.ui.value.editing)
        assertFalse(vm.ui.value.saving)
        assertTrue(vm.ui.value.items.isEmpty())
        assertEquals(listOf(R.string.agent_proposal_approved_task), notices())
    }

    @Test
    fun `ubah lalu setujui jadwal nonaktif mengirim semua kolom dan pesan nonaktif`() = runTest(dispatcher) {
        repo.items += proposal("s1", kind = "schedule")
        val vm = vm()
        runCurrent()
        vm.startEdit(vm.ui.value.items.single())
        assertEquals("0 7 * * 1", vm.ui.value.edit.cron)
        vm.onNameChange("Berita pagi")
        vm.onCronChange("0 6 * * 1")
        vm.onTimezoneChange("Asia/Makassar")
        vm.onPromptChange("Ringkas berita pagi.")
        vm.onEnabledChange(false)
        vm.approveEdited()
        runCurrent()
        assertEquals(
            listOf(
                AgentProposalEdits(
                    name = "Berita pagi",
                    cron = "0 6 * * 1",
                    timezone = "Asia/Makassar",
                    prompt = "Ringkas berita pagi.",
                    enabled = false
                )
            ),
            repo.editsSent
        )
        assertEquals(listOf(R.string.agent_proposal_approved_schedule_disabled), notices())
    }

    @Test
    fun `kolom wajib kosong tidak dikirim dan dialog tetap terbuka`() = runTest(dispatcher) {
        repo.items += listOf(proposal("t1"), proposal("s1", kind = "schedule"))
        val vm = vm()
        runCurrent()
        vm.startEdit(vm.ui.value.items.first { it.id == "t1" })
        vm.onTitleChange("   ")
        vm.approveEdited()
        runCurrent()
        assertTrue(repo.approved.isEmpty())
        assertNotNull(vm.ui.value.editing)

        vm.cancelEdit()
        vm.startEdit(vm.ui.value.items.first { it.id == "s1" })
        vm.onCronChange("")
        vm.approveEdited()
        runCurrent()
        assertTrue(repo.approved.isEmpty())
        assertNotNull(vm.ui.value.editing)
    }

    @Test
    fun `isian dipotong pada batas kontrak`() = runTest(dispatcher) {
        repo.items += listOf(proposal("t1"), proposal("s1", kind = "schedule"))
        val vm = vm()
        runCurrent()
        vm.startEdit(vm.ui.value.items.first { it.id == "t1" })
        vm.onTitleChange("a".repeat(TASK_PROPOSAL_TITLE_MAX + 50))
        vm.onBodyChange("b".repeat(TASK_PROPOSAL_BODY_MAX + 50))
        assertEquals(TASK_PROPOSAL_TITLE_MAX, vm.ui.value.edit.title.length)
        assertEquals(TASK_PROPOSAL_BODY_MAX, vm.ui.value.edit.body.length)

        vm.cancelEdit()
        vm.startEdit(vm.ui.value.items.first { it.id == "s1" })
        vm.onNameChange("c".repeat(SCHEDULE_PROPOSAL_NAME_MAX + 50))
        vm.onPromptChange("d".repeat(SCHEDULE_PROPOSAL_PROMPT_MAX + 50))
        assertEquals(SCHEDULE_PROPOSAL_NAME_MAX, vm.ui.value.edit.name.length)
        assertEquals(SCHEDULE_PROPOSAL_PROMPT_MAX, vm.ui.value.edit.prompt.length)
    }

    @Test
    fun `409 saat menyetujui hasil suntingan menutup dialog dengan pesan sudah diputuskan`() = runTest(dispatcher) {
        repo.items += proposal("t1")
        val vm = vm()
        runCurrent()
        vm.startEdit(vm.ui.value.items.single())
        vm.onTitleChange("Judul baru")
        repo.items.clear()
        repo.failNext = problem(409, DECIDED_409)
        vm.approveEdited()
        runCurrent()
        assertEquals(listOf(R.string.agent_proposal_decided), notices())
        assertNull(vm.ui.value.editing)
        assertFalse(vm.ui.value.saving)
    }

    @Test
    fun `cron salah dari server jadi pesan sendiri dan isian tidak hilang`() = runTest(dispatcher) {
        repo.items += proposal("s1", kind = "schedule")
        val vm = vm()
        runCurrent()
        vm.startEdit(vm.ui.value.items.single())
        vm.onCronChange("99 7 * * 1")
        repo.failNext = problem(400, INVALID_CRON_400)
        vm.approveEdited()
        runCurrent()
        assertEquals(listOf(R.string.agent_proposal_invalid_cron), notices())
        assertNotNull(vm.ui.value.editing)
        assertEquals("99 7 * * 1", vm.ui.value.edit.cron)
        assertFalse(vm.ui.value.saving)
        assertEquals(listOf("s1"), vm.ui.value.items.map { it.id })
    }
}
