package app.aios.android

import app.aios.android.data.api.ConversationProgress
import app.aios.android.data.realtime.Frame
import app.aios.android.data.realtime.Frames
import app.aios.android.ui.chat.activity.ProgressChip
import app.aios.android.ui.chat.activity.ProgressStep
import app.aios.android.ui.chat.activity.ProgressUsed
import app.aios.android.ui.chat.activity.ProgressView
import app.aios.android.ui.chat.activity.StepState
import app.aios.android.ui.chat.activity.RunTrace
import app.aios.android.ui.chat.activity.buildProgress
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * Fixture emas bersama desktop (P2B) dan Android (P6): packages/contracts/fixtures/progress (sumber yang SAMA
 * dengan apps/desktop/src/realtime/progressFixtures.test.ts, tersedia di classpath tes lewat
 * sourceSets.test.resources, lihat build.gradle.kts). Diubah hanya dengan sengaja.
 */
private val json = Json { ignoreUnknownKeys = true }

private fun fixtureDir(): File = File(
    checkNotNull(ProgressBuilderTest::class.java.classLoader.getResource("progress")) {
        "fixture progress tidak ada di classpath; periksa sourceSets.test.resources di build.gradle.kts"
    }.toURI()
)

private fun replayAll(fixture: JsonObject, runId: String?): RunTrace {
    var trace = RunTrace()
    fixture["events"]!!.jsonArray.forEach { e ->
        val o = e.jsonObject
        val frame = JsonObject(
            mapOf("channel" to kotlinx.serialization.json.JsonPrimitive("run:${runId ?: "fixture"}")) + o
        )
        val envelope = Frames.parse(frame.toString(), json) as Frame.Envelope
        trace = trace.reduce(envelope.event, envelope.ts)
    }
    return trace
}

private fun stepStateOf(name: String): StepState = when (name) {
    "done" -> StepState.Done
    "active" -> StepState.Active
    "pending" -> StepState.Pending
    "blocked" -> StepState.Blocked
    "abandoned" -> StepState.Abandoned
    else -> error("state tidak dikenal: $name")
}

private fun JsonObject.toView(): ProgressView {
    val steps = this["steps"]!!.jsonArray.map { s ->
        val o = s.jsonObject
        ProgressStep(
            id = o["id"]!!.jsonPrimitive.content,
            label = o["label"]!!.jsonPrimitive.content,
            state = stepStateOf(o["state"]!!.jsonPrimitive.content),
            blocker = o["blocker"]?.jsonPrimitive?.contentOrNull,
            phase = o["phase"]?.jsonPrimitive?.contentOrNull
        )
    }
    val chip = this["chip"]!!.let { c ->
        if (c is kotlinx.serialization.json.JsonNull) {
            null
        } else {
            val o = c.jsonObject
            ProgressChip(
                current = o["current"]!!.jsonPrimitive.int,
                total = o["total"]?.jsonPrimitive?.contentOrNull?.toIntOrNull(),
                label = o["label"]!!.jsonPrimitive.content
            )
        }
    }
    val u = this["used"]!!.jsonObject
    val used = ProgressUsed(
        uploads = u["uploads"]!!.jsonArray.map { a ->
            val o = a.jsonObject
            o["fileId"]!!.jsonPrimitive.content to o["name"]!!.jsonPrimitive.content
        },
        skills = u["skills"]!!.jsonArray.map { it.jsonPrimitive.content },
        memoryRead = u["memory"]!!.jsonObject["read"]!!.jsonPrimitive.int,
        memoryItems = u["memory"]!!.jsonObject["items"]!!.jsonArray.map { i ->
            val o = i.jsonObject
            o["id"]!!.jsonPrimitive.content to o["title"]!!.jsonPrimitive.content
        },
        engine = u["engine"]?.jsonPrimitive?.contentOrNull,
        model = u["model"]?.jsonPrimitive?.contentOrNull,
        tools = u["tools"]!!.jsonArray.map { toolGroupOf(it.jsonPrimitive.content) },
        connectors = u["connectors"]!!.jsonArray.map { it.jsonPrimitive.content }
    )
    return ProgressView(
        hasPlan = this["hasPlan"]!!.jsonPrimitive.content.toBoolean(),
        steps = steps,
        chip = chip,
        // Output dibandingkan terpisah di bawah (tipe DTO, bukan JSON mentah).
        outputs = emptyList(),
        used = used
    )
}

private fun toolGroupOf(name: String) = when (name) {
    "web" -> app.aios.android.ui.chat.activity.ToolGroup.Web
    "browser" -> app.aios.android.ui.chat.activity.ToolGroup.Browser
    "terminal" -> app.aios.android.ui.chat.activity.ToolGroup.Terminal
    "files" -> app.aios.android.ui.chat.activity.ToolGroup.Files
    "subagent" -> app.aios.android.ui.chat.activity.ToolGroup.Subagent
    else -> error("grup tool tidak dikenal: $name")
}

/** Ringkasan output untuk dibandingkan tanpa field waktu (presisi ISO string vs epoch bisa berbeda format). */
private fun outputsSummary(outputs: List<app.aios.android.data.api.ProgressOutput>): List<String> = outputs.map {
    when (it) {
        is app.aios.android.data.api.ProgressOutput.Image -> "image:${it.fileId}"
        is app.aios.android.data.api.ProgressOutput.FileOutput -> "file:${it.fileId}"
        is app.aios.android.data.api.ProgressOutput.Diff -> "diff:" + it.files.joinToString(",") { f -> f.path }
        is app.aios.android.data.api.ProgressOutput.Research -> "research:${it.researchId}"
        is app.aios.android.data.api.ProgressOutput.Unknown -> "unknown"
    }
}

class ProgressBuilderTest {
    private val texts = XmlActivityTexts(File("src/main/res/values/strings_activity.xml"))

    private val fixtures: List<JsonObject> = fixtureDir().listFiles { f -> f.extension == "json" }!!
        .sortedBy { it.name }
        .map { json.parseToJsonElement(it.readText()).jsonObject }

    @Test
    fun adaFixtureUntukRencanaTengahJalanTanpaRencanaMuatUlangDanLangkahTerhambat() {
        assertEquals(
            listOf("blocked-and-abandoned", "hermes-no-plan", "plan-midway", "reload-complete"),
            fixtures.map { it["name"]!!.jsonPrimitive.content }
        )
    }

    @Test
    fun keluaranSamaPersisDenganFixtureEmas() {
        for (f in fixtures) {
            val name = f["name"]!!.jsonPrimitive.content
            val runId = f["runId"]?.jsonPrimitive?.contentOrNull
            val now = Instant.parse(f["now"]!!.jsonPrimitive.content).toEpochMilli()
            val response = f["response"]!!.let { r ->
                if (r is kotlinx.serialization.json.JsonNull) {
                    null
                } else {
                    json.decodeFromJsonElement<ConversationProgress>(r)
                }
            }
            val trace = if (runId != null && f["events"]!!.jsonArray.isNotEmpty()) replayAll(f, runId) else null
            val view = buildProgress(response, trace, runId, now, texts)
            val expected = f["view"]!!.jsonObject.toView()

            assertEquals("$name: hasPlan", expected.hasPlan, view.hasPlan)
            assertEquals("$name: steps", expected.steps, view.steps)
            assertEquals("$name: chip", expected.chip, view.chip)
            assertEquals("$name: used", expected.used, view.used)
            val expectedOutputs = f["view"]!!.jsonObject["outputs"]!!.jsonArray.map { o ->
                json.decodeFromJsonElement<app.aios.android.data.api.ProgressOutput>(o)
            }
            assertEquals(
                "$name: outputs",
                outputsSummary(expectedOutputs),
                outputsSummary(view.outputs)
            )
        }
    }

    @Test
    fun murniDuaPanggilanBerurutanMemberiHasilSama() {
        val f = fixtures.first { it["name"]!!.jsonPrimitive.content == "plan-midway" }
        val runId = f["runId"]!!.jsonPrimitive.content
        val now = Instant.parse(f["now"]!!.jsonPrimitive.content).toEpochMilli()
        val response = json.decodeFromJsonElement<ConversationProgress>(f["response"]!!)
        val trace = replayAll(f, runId)
        val a = buildProgress(response, trace, runId, now, texts)
        val b = buildProgress(response, trace, runId, now, texts)
        assertEquals(a, b)
    }
}
