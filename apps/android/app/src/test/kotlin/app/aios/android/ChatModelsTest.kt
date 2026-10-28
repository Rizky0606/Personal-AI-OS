package app.aios.android

import app.aios.android.data.api.Message
import app.aios.android.data.api.MessagePart
import app.aios.android.data.api.Page
import app.aios.android.data.api.SendMessageRequest
import app.aios.android.data.api.InputPart
import app.aios.android.data.realtime.Frame
import app.aios.android.data.realtime.Frames
import app.aios.android.data.realtime.ServerEvent
import app.aios.android.ui.chat.ChatItem
import app.aios.android.ui.chat.ChatUiState
import app.aios.android.ui.chat.LiveRun
import app.aios.android.ui.chat.PendingMessage
import app.aios.android.ui.chat.buildChatItems
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bentuk JSON mengikuti contoh nyata dari gateway (packages/contracts). */
class ChatModelsTest {
    @Test
    fun `halaman pesan dengan semua jenis bagian dan bagian tak dikenal`() {
        val body = """
            {"items":[{"id":"0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f","conversationId":"c","author":"assistant",
              "parts":[{"type":"text","text":"Halo"},
                       {"type":"tool","toolCallId":"t1","name":"web.search","target":"emas","status":"ok","durationMs":900},
                       {"type":"file","fileId":"f","name":"a.png","mime":"image/png"},
                       {"type":"hologram","x":1}],
              "agentRole":"general","model":"router-fast","runId":null,"createdAt":"2026-10-22T06:00:00.000Z"}],
             "nextBefore":"abc"}
        """.trimIndent()
        val page = testJson.decodeFromString<Page<Message>>(body)
        val parts = page.items.single().parts
        assertEquals("abc", page.nextBefore)
        assertEquals(MessagePart.Text("Halo"), parts[0])
        assertEquals("ok", (parts[1] as MessagePart.Tool).status)
        assertEquals("image/png", (parts[2] as MessagePart.File).mime)
        assertTrue(parts[3] is MessagePart.Unknown)
        assertEquals("Halo", page.items.single().text)
    }

    @Test
    fun `bagian pesan bisa disimpan dan dibaca ulang dari cache dengan type tetap ada`() {
        val serializer = ListSerializer(MessagePart.serializer())
        val parts = listOf(MessagePart.Text("a"), MessagePart.Tool("t", "n", null, "running", null))
        val json = testJson.encodeToString(serializer, parts)
        assertTrue(json, json.contains(""""type":"text"""") && json.contains(""""type":"tool""""))
        assertEquals(parts, testJson.decodeFromString(serializer, json))
    }

    @Test
    fun `request kirim pesan hanya memuat field yang diisi`() {
        val json = testJson.encodeToString(SendMessageRequest(listOf(InputPart.text("hai"))))
        assertEquals("""{"parts":[{"type":"text","text":"hai"}]}""", json)
        val withModel = testJson.encodeToString(
            SendMessageRequest(listOf(InputPart.text("hai")), model = "router-fast")
        )
        assertEquals("""{"parts":[{"type":"text","text":"hai"}],"model":"router-fast"}""", withModel)
    }

    @Test
    fun `frame server diurai ke tipe yang tepat`() {
        val env = Frames.parse(envelope("run:r1", 5, delta("m", "x")), testJson) as Frame.Envelope
        assertEquals(5L, env.seq)
        assertEquals(ServerEvent.MessageDelta("m", "x"), env.event)

        assertEquals(Frame.Subscribed("run:r1", 7, true), Frames.parse(subscribed("run:r1", 7), testJson))
        assertEquals(Frame.Pong, Frames.parse("""{"type":"pong"}""", testJson))
        assertEquals(
            Frame.ProtocolError("not_found", "tidak ada", "run:x"),
            Frames.parse("""{"type":"error","code":"not_found","message":"tidak ada","channel":"run:x"}""", testJson)
        )
        assertEquals(Frame.Unknown, Frames.parse("{rusak", testJson))
        assertEquals(Frame.Unknown, Frames.parse("""{"type":"masa-depan"}""", testJson))
    }

    @Test
    fun `frame berlangganan memakai format kontrak`() {
        assertEquals("""{"type":"subscribe","channel":"run:r1","lastSeq":41}""", Frames.subscribe("run:r1", 41))
        assertEquals("""{"type":"unsubscribe","channel":"run:r1"}""", Frames.unsubscribe("run:r1"))
    }

    @Test
    fun `event dengan field tambahan dan tipe baru tidak merusak`() {
        val ev = Frames.parse(
            envelope("run:r1", 1, """{"type":"tool.output","toolCallId":"t","chunk":"x","stream":"stdout"}"""),
            testJson
        ) as Frame.Envelope
        assertEquals(ServerEvent.Other("tool.output"), ev.event)
    }

    @Test
    fun `LiveRun menyusun teks, role, dan langkah tool`() {
        val events = listOf(
            ServerEvent.RunStatus("running"),
            ServerEvent.RouteDecided("writer", 0.8, "x"),
            ServerEvent.ToolStarted("t1", "web.search", "emas"),
            ServerEvent.MessageDelta("m1", "Ha"),
            ServerEvent.ToolFinished("t1", "ok", 500),
            ServerEvent.MessageDelta("m1", "lo")
        )
        val live = events.fold(LiveRun("r")) { acc, e -> acc.reduce(e) }
        assertEquals("Halo", live.text)
        assertEquals("m1", live.messageId)
        assertEquals("writer", live.role)
        assertEquals("ok", live.tools.single().status)
        assertEquals(false, live.finished)
        assertTrue(live.reduce(ServerEvent.RunStatus("failed")).finished)
    }

    @Test
    fun `daftar item - pesan live menggantikan placeholder kosong dan hanya pesan terakhir yang bisa diedit`() {
        val state = ChatUiState(
            conversationId = "c1",
            messages = listOf(
                message("u1", "user", "tanya 1", "r1"),
                message("a1", "assistant", "jawab 1", "r1", "general"),
                message("u2", "user", "tanya 2", "r2"),
                message("a2", "assistant", "", "r2", "general")
            ),
            live = LiveRun("r2", role = "writer", status = "running", messageId = "a2", text = "sedang")
        )
        val items = buildChatItems(state)
        val assistants = items.filterIsInstance<ChatItem.Assistant>()
        assertEquals(listOf("a1", "a2"), assistants.map { it.id })
        assertEquals("sedang", assistants[1].text)
        assertEquals("writer", assistants[1].role)
        assertTrue(assistants[1].streaming)

        val done =
            buildChatItems(
                state.copy(
                    live = null,
                    messages = state.messages.dropLast(1) + message("a2", "assistant", "selesai", "r2", "general")
                )
            )
        assertEquals(listOf(false, true), done.filterIsInstance<ChatItem.User>().map { it.canEdit })
    }

    @Test
    fun `pesan tertunda tampil di akhir, live tanpa baris tersimpan ditambahkan`() {
        val state = ChatUiState(
            conversationId = "c1",
            messages = listOf(message("u1", "user", "tanya", "r1")),
            pending = PendingMessage("baru"),
            live = LiveRun("r1", text = "sebagian", status = "running")
        )
        val items = buildChatItems(state)
        assertTrue(items[0] is ChatItem.User)
        assertTrue(items[1] is ChatItem.PendingUser)
        assertEquals("sebagian", (items[2] as ChatItem.Assistant).text)
    }
}
