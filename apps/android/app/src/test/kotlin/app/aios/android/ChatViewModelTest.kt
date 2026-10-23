package app.aios.android

import app.aios.android.data.api.AUTHOR_ASSISTANT
import app.aios.android.data.realtime.Backoff
import app.aios.android.data.realtime.ConnectionState
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.ui.chat.ChatEvent
import app.aios.android.ui.chat.ChatItem
import app.aios.android.ui.chat.ChatViewModel
import app.aios.android.ui.chat.buildChatItems
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
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
import org.junit.Rule
import org.junit.Test
import org.junit.rules.Timeout
import retrofit2.HttpException
import retrofit2.Response

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    /** Tes dengan jam virtual yang salah bisa berputar selamanya; batas waktu membuatnya gagal dengan nama jelas. */
    @get:Rule
    val timeout: Timeout = Timeout.seconds(30)

    private val scheduler = kotlinx.coroutines.test.TestCoroutineScheduler()
    private val dispatcher = StandardTestDispatcher(scheduler)

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class Rig(scope: TestScope) {
        /** Menghentikan loop polling abadi di viewModelScope supaya runTest bisa selesai. */
        fun close() = vm.viewModelScope.cancel()

        val repo = FakeChatRepo()
        val ws = FakeWsTransport().also { it.clock = { scope.currentTime } }
        val tokens = FakeTokens()
        val connectivity = FakeConnectivity()
        val realtime = RealtimeClient(scope.backgroundScope, ws, tokens, Backoff(), lingerMs = 60_000)
        val vm = ChatViewModel(repo, realtime, connectivity)
        val notices = mutableListOf<Int>()

        init {
            scope.backgroundScope.launch {
                vm.events.collect { if (it is ChatEvent.Notice) notices += it.message }
            }
        }

        val conn get() = ws.connections.last()
        val ui get() = vm.ui.value
    }

    private fun runVmTest(block: suspend TestScope.(Rig) -> Unit) = runTest(dispatcher) {
        val rig = Rig(this)
        try {
            block(rig)
        } finally {
            rig.close()
        }
    }

    /** Membuka percakapan c1 yang sudah punya satu pasang pesan lama. */
    private suspend fun TestScope.openC1(r: Rig) {
        r.repo.put(
            "c1",
            message("m0", "user", "pertanyaan lama", "r0"),
            message("m0a", AUTHOR_ASSISTANT, "jawaban lama", "r0", "general")
        )
        r.repo.runs["r0"] = run("r0", "completed")
        r.vm.open("c1")
        runCurrent()
    }

    private fun TestScope.type(r: Rig, text: String) {
        r.vm.onDraft(text)
        r.vm.send()
        runCurrent()
    }

    @Test
    fun `membuka percakapan menampilkan pesan dari cache lalu menyegarkan dari server`() = runVmTest { r ->
        openC1(r)

        assertEquals(2, r.ui.messages.size)
        assertFalse(r.ui.loading)
        assertTrue(r.repo.refreshCalls >= 1)
    }

    @Test
    fun `kirim lalu streaming sampai selesai - delta menyusun teks, selesai mengambil hasil akhir dari server`() =
        runVmTest { r ->
            openC1(r)
            r.vm.selectModel("router-smart")

            type(r, "  Halo dunia  ")

            assertEquals(Triple("c1", "Halo dunia", "router-smart"), r.repo.sendCalls.single())
            assertEquals("", r.ui.draft)
            assertNull(r.ui.pending)
            assertTrue(r.ui.streaming)
            val conn = r.conn.also { it.open() }
            runCurrent()
            assertEquals(listOf("run:r1" to 0L), conn.subscribes())

            conn.server(envelope("run:r1", 1, status("running")))
            conn.server(
                envelope("run:r1", 2, """{"type":"route.decided","role":"writer","confidence":0.9,"reason":"x"}""")
            )
            conn.server(
                envelope(
                    "run:r1",
                    3,
                    """{"type":"tool.started","toolCallId":"t1","name":"web.search","target":"harga emas"}"""
                )
            )
            conn.server(
                envelope("run:r1", 4, """{"type":"tool.finished","toolCallId":"t1","status":"ok","durationMs":1200}""")
            )
            conn.server(envelope("run:r1", 5, delta("a-r1", "Ha")))
            conn.server(envelope("run:r1", 6, delta("a-r1", "lo")))
            runCurrent()

            val live = r.ui.live!!
            assertEquals("Halo", live.text)
            assertEquals("writer", live.role)
            assertEquals("ok", live.tools.single().status)
            assertEquals(1200L, live.tools.single().durationMs)
            assertTrue(r.ui.streaming)

            r.repo.onRefresh = { r.repo.completeAssistant("c1", "r1", "Halo", "writer") }
            conn.server(envelope("run:r1", 7, """{"type":"message.completed","messageId":"a-r1"}"""))
            conn.server(envelope("run:r1", 8, status("completed")))
            runCurrent()

            assertNull(r.ui.live)
            assertFalse(r.ui.streaming)
            assertNull(r.ui.runError)
            assertEquals("Halo", r.ui.messages.last().text)
            val items = buildChatItems(r.ui)
            assertEquals(1, items.filterIsInstance<ChatItem.Assistant>().count { it.id == "a-r1" })
        }

    @Test
    fun `putus di tengah jawaban lalu tersambung lagi tanpa teks hilang atau ganda`() = runVmTest { r ->
        openC1(r)
        type(r, "Halo")
        val first = r.conn.also { it.open() }
        runCurrent()
        first.server(envelope("run:r1", 1, delta("a-r1", "Ha")))
        first.server(envelope("run:r1", 2, delta("a-r1", "lo")))
        runCurrent()
        assertEquals("Halo", r.ui.live!!.text)

        first.drop()
        runCurrent()
        assertTrue(r.vm.connection.value is ConnectionState.Reconnecting)
        assertTrue("jawaban tetap tampil selama menyambung ulang", r.ui.live!!.text == "Halo")

        advanceTimeBy(1_000)
        runCurrent()
        val second = r.conn.also { it.open() }
        runCurrent()
        assertEquals(listOf("run:r1" to 2L), second.subscribes())

        // Server memutar ulang seq yang terlewat saja, ditambah event baru; duplikat tidak boleh masuk dua kali.
        second.server(envelope("run:r1", 2, delta("a-r1", "lo")))
        second.server(envelope("run:r1", 3, delta("a-r1", " dunia")))
        runCurrent()
        assertEquals("Halo dunia", r.ui.live!!.text)

        r.repo.onRefresh = { r.repo.completeAssistant("c1", "r1", "Halo dunia") }
        second.server(envelope("run:r1", 4, status("completed")))
        runCurrent()
        assertNull(r.ui.live)
        assertEquals("Halo dunia", r.ui.messages.last().text)
    }

    @Test
    fun `status selesai yang terlewat saat putus tetap tertangkap lewat replay setelah sambung ulang`() =
        runVmTest { r ->
            openC1(r)
            type(r, "Halo")
            val first = r.conn.also { it.open() }
            runCurrent()
            first.server(envelope("run:r1", 1, delta("a-r1", "Selesai")))
            runCurrent()

            first.drop()
            runCurrent()
            advanceTimeBy(1_000)
            runCurrent()
            val second = r.conn.also { it.open() }
            r.repo.onRefresh = { r.repo.completeAssistant("c1", "r1", "Selesai") }
            second.server(envelope("run:r1", 2, status("completed")))
            runCurrent()

            assertNull(r.ui.live)
            assertEquals("Selesai", r.ui.messages.last().text)
        }

    @Test
    fun `polling status menutup run bila event penutup tidak pernah sampai`() = runVmTest { r ->
        openC1(r)
        type(r, "Halo")
        r.conn.open()
        runCurrent()
        assertTrue(r.ui.streaming)

        r.repo.runs["r1"] = run("r1", "completed")
        r.repo.onRefresh = { r.repo.completeAssistant("c1", "r1", "dari polling") }
        advanceTimeBy(15_001)
        runCurrent()

        assertNull(r.ui.live)
        assertEquals("dari polling", r.ui.messages.last().text)
    }

    @Test
    fun `run gagal menampilkan error dan tombol kirim ulang`() = runVmTest { r ->
        openC1(r)
        type(r, "Halo")
        val conn = r.conn.also { it.open() }
        runCurrent()
        conn.server(
            envelope(
                "run:r1",
                1,
                """{"type":"error","code":"model_unavailable","message":"Model tidak tersedia","retryable":true}"""
            )
        )
        conn.server(envelope("run:r1", 2, status("failed")))
        runCurrent()

        assertNull(r.ui.live)
        assertEquals("model_unavailable", r.ui.runError?.code)
        val failure = buildChatItems(r.ui).last() as ChatItem.Failure
        assertEquals("Model tidak tersedia", failure.message)

        r.vm.resendLast()
        runCurrent()
        assertEquals(2, r.repo.sendCalls.size)
        assertNull(r.ui.runError)
    }

    @Test
    fun `hentikan memanggil cancel untuk run yang sedang mengalir`() = runVmTest { r ->
        openC1(r)
        type(r, "Halo")
        r.conn.open()
        runCurrent()

        r.vm.stop()
        runCurrent()

        assertEquals(listOf("r1"), r.repo.cancelCalls)
    }

    @Test
    fun `offline - pesan tidak dikirim, draft dipertahankan, ada pemberitahuan`() = runVmTest { r ->
        openC1(r)
        r.connectivity.state.value = false
        runCurrent()

        type(r, "Halo")

        assertTrue(r.repo.sendCalls.isEmpty())
        assertEquals("Halo", r.ui.draft)
        assertEquals(listOf(R.string.chat_error_offline_send), r.notices)
    }

    @Test
    fun `kirim gagal dari server mengembalikan draft dan menampilkan pesan error`() = runVmTest { r ->
        openC1(r)
        r.repo.failSend = HttpException(
            Response.error<Unit>(
                409,
                """{"type":"t","title":"t","status":409,"detail":"d","code":"conversation_archived"}"""
                    .toResponseBody("application/problem+json".toMediaType())
            )
        )

        type(r, "Halo")

        assertEquals("Halo", r.ui.draft)
        assertNull(r.ui.pending)
        assertFalse(r.ui.sending)
        assertNull(r.ui.live)
        assertEquals(1, r.notices.size)
    }

    @Test
    fun `percakapan baru dibuat saat pesan pertama dikirim`() = runVmTest { r ->
        r.vm.open(null)
        runCurrent()

        type(r, "Halo")

        assertEquals(1, r.repo.createCalls)
        assertEquals("new-1", r.ui.conversationId)
        assertEquals("new-1", r.repo.sendCalls.single().first)
    }

    @Test
    fun `ganti role memanggil reroute pada jawaban terakhir lalu mengikuti run baru`() = runVmTest { r ->
        openC1(r)

        r.vm.reroute("writer")
        runCurrent()

        assertEquals(listOf("m0a" to "writer"), r.repo.rerouteCalls)
        assertEquals("r2", r.ui.live?.runId)
        val conn = r.conn.also { it.open() }
        runCurrent()
        assertEquals(listOf("run:r2" to 0L), conn.subscribes())
    }

    @Test
    fun `ganti role ditolak saat jawaban sedang mengalir`() = runVmTest { r ->
        openC1(r)
        type(r, "Halo")
        r.conn.open()
        runCurrent()

        r.vm.reroute("writer")
        runCurrent()

        assertTrue(r.repo.rerouteCalls.isEmpty())
    }

    @Test
    fun `membuka percakapan dengan run yang masih berjalan melanjutkan streaming dari awal`() = runVmTest { r ->
        r.repo.put("c1", message("u1", "user", "tanya", "r9"), message("a1", AUTHOR_ASSISTANT, "", "r9", "general"))
        r.repo.runs["r9"] = run("r9", "running")

        r.vm.open("c1")
        runCurrent()
        val conn = r.conn.also { it.open() }
        runCurrent()

        assertEquals("r9", r.ui.live?.runId)
        assertEquals(listOf("run:r9" to 0L), conn.subscribes())
        conn.server(envelope("run:r9", 1, delta("a1", "sebagian")))
        runCurrent()
        assertEquals("sebagian", r.ui.live!!.text)
        val assistants = buildChatItems(r.ui).filterIsInstance<ChatItem.Assistant>()
        assertEquals("pesan kosong dari server digantikan versi live", 1, assistants.size)
        assertEquals("sebagian", assistants.single().text)
    }

    @Test
    fun `gagal memuat tanpa cache menampilkan error layar penuh, dengan cache hanya cache`() = runVmTest { r ->
        r.repo.failRefresh = java.io.IOException("mati")
        r.vm.open("c1")
        runCurrent()
        assertNotNull(r.ui.loadError)
        assertFalse(r.ui.loading)

        r.vm.open(null)
        r.repo.put("c2", message("x", "user", "ada cache", "r0", conversationId = "c2"))
        r.vm.open("c2")
        runCurrent()
        assertNull(r.ui.loadError)
        assertEquals(1, r.ui.messages.size)
    }

    @Test
    fun `edit mengisi composer dengan teks pesan terakhir`() = runVmTest { r ->
        openC1(r)

        r.vm.editLast()

        assertEquals("pertanyaan lama", r.ui.draft)
        assertTrue(r.repo.sendCalls.isEmpty())
    }

    @Test
    fun `draft tersimpan per percakapan`() = runVmTest { r ->
        openC1(r)
        r.vm.onDraft("setengah ketik")
        r.vm.open("c2")
        runCurrent()
        assertEquals("", r.ui.draft)

        r.vm.open("c1")
        runCurrent()
        assertEquals("setengah ketik", r.ui.draft)
    }

    @Test
    fun `kembali online memicu sambung ulang dan penyegaran`() = runVmTest { r ->
        openC1(r)
        r.connectivity.state.value = false
        runCurrent()
        val before = r.repo.refreshCalls

        r.connectivity.state.value = true
        runCurrent()

        assertTrue(r.repo.refreshCalls > before)
    }

    @Test
    fun `tidak ada panggilan kirim ganda saat sedang mengirim`() = runVmTest { r ->
        openC1(r)
        r.vm.onDraft("Halo")
        r.vm.send()
        r.vm.onDraft("Lagi")
        r.vm.send()
        runCurrent()

        assertEquals(1, r.repo.sendCalls.size)
    }
}
