package app.aios.android

import app.aios.android.data.realtime.Frame
import app.aios.android.data.realtime.Frames
import app.aios.android.ui.chat.activity.Activity
import app.aios.android.ui.chat.activity.ActivityCurrent
import app.aios.android.ui.chat.activity.ActivityPhase
import app.aios.android.ui.chat.activity.ActivityStep
import app.aios.android.ui.chat.activity.ActivityTexts
import app.aios.android.ui.chat.activity.ToolKind
import app.aios.android.ui.chat.activity.RunTrace
import app.aios.android.ui.chat.activity.buildActivity
import app.aios.android.ui.chat.activity.formatElapsed
import app.aios.android.ui.chat.activity.truncateTarget
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Teks dari strings.xml yang SAMA dengan yang dipakai aplikasi (satu sumber): berkas XML dibaca langsung dan
 * diperlakukan seperti aapt (tanda kutip pembungkus dibuang, escape dasar diurai).
 */
internal class XmlActivityTexts(file: File) : ActivityTexts {
    private val strings: Map<String, String> = run {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = doc.getElementsByTagName("string")
        (0 until nodes.length).associate { i ->
            val node = nodes.item(i)
            node.attributes.getNamedItem("name").nodeValue to unescape(node.textContent)
        }
    }

    fun has(key: String) = key in strings

    override fun get(key: String, vararg args: Any): String {
        val raw = strings[key] ?: error("kunci $key tidak ada di strings_activity.xml")
        return if (args.isEmpty()) raw else String.format(raw, *args)
    }

    private fun unescape(raw: String): String {
        var s = raw.trim()
        if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.substring(1, s.length - 1)
        return s.replace("\\'", "'").replace("\\\"", "\"").replace("\\n", "\n")
    }
}

private val json = Json { ignoreUnknownKeys = true }

/** Folder fixture bersama (packages/contracts/fixtures/activity) di classpath tes. */
private fun fixtureDir(): File = File(
    checkNotNull(ActivityParityTest::class.java.classLoader.getResource("activity")) {
        "fixture activity tidak ada di classpath; periksa sourceSets.test.resources di build.gradle.kts"
    }.toURI()
)

private fun phaseOf(name: String): ActivityPhase = when (name) {
    "idle" -> ActivityPhase.Idle
    "thinking" -> ActivityPhase.Thinking
    "tool" -> ActivityPhase.Tool
    "writing" -> ActivityPhase.Writing
    "waiting_approval" -> ActivityPhase.WaitingApproval
    "done" -> ActivityPhase.Done
    "error" -> ActivityPhase.Error
    "cancelled" -> ActivityPhase.Cancelled
    else -> error("fase tidak dikenal: $name")
}

private fun JsonElement.stringOrNull(): String? = if (this is JsonNull) null else jsonPrimitive.content
private fun JsonElement.longOrNull(): Long? = if (this is JsonNull) null else jsonPrimitive.long

private fun JsonObject.toActivity(): Activity = Activity(
    headline = this["headline"]!!.stringOrNull(),
    phase = phaseOf(this["phase"]!!.jsonPrimitive.content),
    current = this["current"]!!.let { c ->
        if (c is JsonNull) {
            null
        } else {
            val o = c.jsonObject
            ActivityCurrent(
                o["label"]!!.jsonPrimitive.content,
                o["target"]?.stringOrNull(),
                o["parallel"]!!.jsonPrimitive.int
            )
        }
    },
    stepCount = this["stepCount"]!!.jsonPrimitive.int,
    hiddenCount = this["hiddenCount"]!!.jsonPrimitive.int,
    elapsedMs = this["elapsedMs"]!!.jsonPrimitive.long,
    steps = this["steps"]!!.jsonArray.map { s ->
        val o = s.jsonObject
        ActivityStep(
            id = o["id"]!!.jsonPrimitive.content,
            label = o["label"]!!.jsonPrimitive.content,
            target = o["target"]?.stringOrNull(),
            status = o["status"]!!.jsonPrimitive.content,
            durationMs = o["durationMs"]!!.longOrNull(),
            startedAt = o["startedAt"]!!.longOrNull()
        )
    },
    summary = this["summary"]!!.stringOrNull(),
    needsAttention = this["needsAttention"]!!.jsonPrimitive.content.toBoolean()
)

/** Menerapkan event fixture lewat parser frame yang sama dengan aplikasi (Frames.parse), termasuk `ts`. */
private fun replay(fixture: JsonObject, applied: Int): RunTrace {
    var trace = RunTrace()
    fixture["runCreatedAt"]?.let { trace = trace.withRunStart(Instant.parse(it.jsonPrimitive.content).toEpochMilli()) }
    fixture["events"]!!.jsonArray.take(applied).forEach { e ->
        val o = e.jsonObject
        val frame = JsonObject(mapOf("channel" to kotlinx.serialization.json.JsonPrimitive("run:fixture")) + o)
        val envelope = Frames.parse(frame.toString(), json) as Frame.Envelope
        trace = trace.reduce(envelope.event, envelope.ts)
    }
    return trace
}

class ActivityParityTest {
    private val texts = XmlActivityTexts(File("src/main/res/values/strings_activity.xml"))

    private val fixtures: List<JsonObject> = fixtureDir().listFiles { f -> f.extension == "json" }!!
        .filter { it.name != "format-elapsed.json" }
        .sortedBy { it.name }
        .map { json.parseToJsonElement(it.readText()).jsonObject }

    @Test
    fun semuaSkenarioFixtureEmasTerbaca() {
        assertEquals(
            listOf(
                "cancelled", "fourteen-tools", "hermes-no-reasoning", "out-of-order-tool", "parallel-tools",
                "reload-mid-run", "short-no-tools", "tool-error-mid", "waiting-approval"
            ),
            fixtures.map { it["name"]!!.jsonPrimitive.content }
        )
    }

    @Test
    fun keluaranIdentikDenganDesktopPadaSetiapTitikFixture() {
        var checked = 0
        for (fixture in fixtures) {
            val name = fixture["name"]!!.jsonPrimitive.content
            val visible = fixture["visibleSteps"]!!.jsonPrimitive.int
            for (cp in fixture["checkpoints"]!!.jsonArray) {
                val o = cp.jsonObject
                val note = o["note"]!!.jsonPrimitive.content
                val now = Instant.parse(o["now"]!!.jsonPrimitive.content).toEpochMilli()
                val trace = replay(fixture, o["applied"]!!.jsonPrimitive.int)
                val actual = buildActivity(trace, now, texts, visible)
                assertEquals("$name / $note", o["activity"]!!.jsonObject.toActivity(), actual)
                checked++
            }
        }
        assertTrue("fixture harus punya banyak titik uji", checked >= 20)
    }

    @Test
    fun formatElapsedSesuaiKasusEmas() {
        val cases = json.parseToJsonElement(File(fixtureDir(), "format-elapsed.json").readText())
            .jsonObject["cases"] as JsonArray
        assertTrue(cases.size > 10)
        for (c in cases) {
            val o = c.jsonObject
            assertEquals(o["text"]!!.jsonPrimitive.content, formatElapsed(texts, o["ms"]!!.jsonPrimitive.long))
        }
    }

    @Test
    fun semuaKunciYangDimintaBuilderAdaDiStringsXml() {
        val keys = mutableListOf<String>()
        ToolKind.entries.forEach { k ->
            listOf(
                "running",
                "done",
                "noun"
            ).forEach { keys += "activity_tool_${k.id}_$it" }
        }
        listOf("running", "done", "noun").forEach {
            keys += "activity_unknown_$it"
            keys += "activity_unknown_${it}_anon"
        }
        listOf("error", "denied", "cancelled").forEach { keys += "activity_status_$it" }
        listOf("done", "error", "cancelled").forEach { keys += "activity_summary_$it" }
        keys += listOf(
            "activity_steps", "activity_separator",
            "activity_unit_second", "activity_unit_minute", "activity_unit_hour"
        )
        val missing = keys.filterNot { texts.has(it) }
        assertTrue("kunci tidak ada: $missing", missing.isEmpty())
    }

    @Test
    fun targetDipotongSatuBarisPathDariAwalLainnyaDariAkhir() {
        assertEquals("a b c", truncateTarget("  a\tb   c\nbaris dua"))
        val path = "src/" + "dalam/".repeat(20) + "App.tsx"
        val cut = truncateTarget(path)
        assertEquals(60, cut.length)
        assertTrue(cut.startsWith("…") && cut.endsWith("App.tsx"))
        val url = "https://contoh.com/" + "x".repeat(80)
        val cutUrl = truncateTarget(url)
        assertEquals(60, cutUrl.length)
        assertTrue(cutUrl.startsWith("https://") && cutUrl.endsWith("…"))
    }
}
