package app.aios.android.ui.chat.activity

/*
 * Port Kotlin murni (tanpa Android API) dari apps/desktop/src/realtime/activity.ts: mengubah jejak run (RunTrace)
 * menjadi apa yang ditampilkan baris aktivitas. Perilaku mengikuti desktop dan diuji terhadap fixture emas yang
 * sama (packages/contracts/fixtures/activity). Teks datang dari strings.xml lewat [ActivityTexts].
 *
 * Perbedaan platform yang disengaja:
 * - Waktu berupa Long (ms epoch), bukan number JS; `formatElapsed` menerima Long.
 * - Regex tanpa flag inline (`(?U)` tidak ada di Android/ICU); spasi ditulis eksplisit (WS) agar `\s` setara
 *   dengan JS di JVM maupun Android.
 */

/** Pencari teks bahasa Indonesia berdasarkan kunci `strings.xml` (Android: Resources; tes JVM: berkas XML). */
fun interface ActivityTexts {
    operator fun get(key: String, vararg args: Any): String
}

enum class ActivityPhase { Idle, Thinking, Tool, Writing, WaitingApproval, Done, Error, Cancelled }

enum class ToolKind(val id: String) {
    Command("command"),
    Edit("edit"),
    Read("read"),
    Search("search"),
    Web("web"),
    Browser("browser"),
    Subagent("subagent"),
    Plan("plan")
}

data class ActivityStep(
    val id: String,
    /** Kalimat langkah menurut status: berjalan, selesai, atau "<kata benda> gagal/ditolak/dibatalkan". */
    val label: String,
    /** Path, URL, atau perintah (dipotong), dipisah dari kalimat supaya bisa ditampilkan redup. */
    val target: String?,
    /** running, ok, error, denied, cancelled. */
    val status: String,
    /** Selesai: durasi dari mesin. Berjalan: sejak mulai (null bila waktu mulai tak diketahui). */
    val durationMs: Long?,
    val startedAt: Long?
)

data class ActivityCurrent(val label: String, val target: String?, val parallel: Int)

data class Activity(
    val headline: String?,
    val phase: ActivityPhase,
    val current: ActivityCurrent?,
    val stepCount: Int,
    /** Langkah di luar `visibleSteps` terbaru (bawaan 3). */
    val hiddenCount: Int,
    val elapsedMs: Long,
    val steps: List<ActivityStep>,
    val summary: String?,
    val needsAttention: Boolean
)

const val DEFAULT_VISIBLE_STEPS = 3
const val HEADLINE_MAX = 80
const val TARGET_MAX = 60

/** Nama tool (huruf kecil) → jenis. Sama dengan TOOL_KINDS di desktop. */
private val TOOL_KINDS: Map<String, ToolKind> = buildMap {
    listOf("bash", "sh", "shell", "terminal", "exec", "execute", "execute_code", "run_command", "command", "powershell")
        .forEach { put(it, ToolKind.Command) }
    listOf(
        "edit", "write", "write_file", "patch", "apply_patch", "str_replace", "str_replace_editor", "multiedit",
        "notebook", "delete", "rm"
    ).forEach { put(it, ToolKind.Edit) }
    listOf("read", "read_file", "view", "cat", "open_file").forEach { put(it, ToolKind.Read) }
    listOf(
        "grep",
        "search",
        "search_files",
        "find",
        "glob",
        "ripgrep",
        "rg",
        "lsp"
    ).forEach { put(it, ToolKind.Search) }
    listOf("web_search", "websearch", "search_web", "fetch", "web_fetch", "fetch_url", "web").forEach {
        put(it, ToolKind.Web)
    }
    put("browser", ToolKind.Browser)
    listOf("task", "delegate_task", "subagent").forEach { put(it, ToolKind.Subagent) }
    listOf("todo", "todowrite", "todo_write").forEach { put(it, ToolKind.Plan) }
}

internal fun kindOf(name: String): ToolKind? {
    val key = name.trim().lowercase()
    TOOL_KINDS[key]?.let { return it }
    if (key.startsWith("browser_")) return ToolKind.Browser
    return null
}

/** Kalimat langkah menurut jenis tool dan status. */
internal fun stepLabel(texts: ActivityTexts, name: String, status: String): String {
    val kind = kindOf(name)
    val trimmed = name.trim()
    return when (status) {
        "running" -> if (kind != null) texts["activity_tool_${kind.id}_running"] else unknown(texts, "running", trimmed)
        "ok" -> if (kind != null) texts["activity_tool_${kind.id}_done"] else unknown(texts, "done", trimmed)
        else -> {
            val noun = if (kind != null) texts["activity_tool_${kind.id}_noun"] else unknown(texts, "noun", trimmed)
            "$noun ${texts["activity_status_$status"]}"
        }
    }
}

private fun unknown(texts: ActivityTexts, form: String, name: String): String =
    if (name.isEmpty()) texts["activity_unknown_${form}_anon"] else texts["activity_unknown_$form", name]

/** Spasi seperti `\s` di JS, ditulis eksplisit agar sama di regex JVM dan ICU (Android). */
private const val WS = "\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

private val WHITESPACE = Regex("[$WS]+")
private val URL_SCHEME = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)

/** Satu baris, spasi dipadatkan, maks 60 karakter: path memotong awal (nama berkas tetap terlihat), lainnya akhir. */
fun truncateTarget(target: String): String {
    val line = target.split('\n').map { it.trim() }.firstOrNull { it.isNotEmpty() }
    val flat = (line ?: "").replace(WHITESPACE, " ")
    if (flat.length <= TARGET_MAX) return flat
    val isUrl = URL_SCHEME.containsMatchIn(flat)
    val isPath = !isUrl && !flat.contains(' ') && (flat.contains('\\') || flat.contains('/'))
    return if (isPath) "…${flat.substring(flat.length - (TARGET_MAX - 1))}" else "${flat.substring(0, TARGET_MAX - 1)}…"
}

private val MD_LINK = Regex("!?\\[([^\\]]*)\\]\\([^)]*\\)")
private val MD_TAG = Regex("<[^>]+>")
private val MD_PREFIX = Regex("^[$WS]*(?:#{1,6}[$WS]+|>[$WS]*|[-*+][$WS]+|\\d+[.)][$WS]+)")
private val MD_EMPHASIS = Regex("(\\*\\*|__|~~|`)")
private val SENTENCE_END = Regex("[.!?](?=[$WS]|$)")

/** Membersihkan satu baris dari penanda markdown. */
private fun stripMarkdown(line: String): String = line
    .replace(MD_LINK, "$1")
    .replace(MD_TAG, "")
    .replace(MD_PREFIX, "")
    .replace(MD_EMPHASIS, "")
    .replace("*", "")
    .replace(WHITESPACE, " ")
    .trim()

/** Judul dari penalaran: baris pertama yang bermakna, sampai akhir kalimat pertama, maks 80 karakter. */
internal fun headlineFrom(reasoning: String): String? {
    for (raw in reasoning.split('\n')) {
        val line = stripMarkdown(raw)
        if (line.isEmpty()) continue
        val end = SENTENCE_END.find(line)
        val sentence = (if (end != null) line.substring(0, end.range.first) else line).trim()
        if (sentence.isEmpty()) continue
        return if (sentence.length > HEADLINE_MAX) {
            "${sentence.substring(0, HEADLINE_MAX - 1).trimEnd()}…"
        } else {
            sentence
        }
    }
    return null
}

private const val MS_PER_SECOND = 1000L
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PER_HOUR = 3600L

/**
 * "8 dtk", "1 mnt 05 dtk", "6 mnt 24 dtk", "1 j 02 mnt". Detik dipotong ke bawah (floor) agar penghitung tidak
 * mendahului waktu nyata; di atas 1 jam detik dibuang dan menit juga dipotong ke bawah.
 */
fun formatElapsed(texts: ActivityTexts, ms: Long): String {
    val second = texts["activity_unit_second"]
    val minute = texts["activity_unit_minute"]
    val hour = texts["activity_unit_hour"]
    val total = if (ms > 0) ms / MS_PER_SECOND else 0L
    return when {
        total < SECONDS_PER_MINUTE -> "$total $second"
        total < SECONDS_PER_HOUR ->
            "${total / SECONDS_PER_MINUTE} $minute ${pad2(total % SECONDS_PER_MINUTE)} $second"
        else ->
            "${total / SECONDS_PER_HOUR} $hour ${pad2(total % SECONDS_PER_HOUR / SECONDS_PER_MINUTE)} $minute"
    }
}

private fun pad2(n: Long): String = n.toString().padStart(2, '0')

private fun phaseOf(trace: RunTrace, running: List<TraceTool>): ActivityPhase {
    when (trace.status) {
        "completed", "needs_review", "accepted", "rejected" -> return ActivityPhase.Done
        "failed" -> return ActivityPhase.Error
        "cancelled" -> return ActivityPhase.Cancelled
    }
    return when {
        trace.status == "waiting_approval" || trace.approvals.isNotEmpty() -> ActivityPhase.WaitingApproval
        running.isNotEmpty() -> ActivityPhase.Tool
        trace.lastActivity == LastActivity.Text -> ActivityPhase.Writing
        trace.lastActivity != null -> ActivityPhase.Thinking
        else -> if (trace.status == "running") ActivityPhase.Thinking else ActivityPhase.Idle
    }
}

/** Setara `buildActivity(live, now, options)` di desktop. [now] dalam ms epoch. */
fun buildActivity(
    trace: RunTrace,
    now: Long,
    texts: ActivityTexts,
    visibleSteps: Int = DEFAULT_VISIBLE_STEPS
): Activity {
    val running = trace.tools.filter { it.status == "running" }
    val phase = phaseOf(trace, running)

    val steps = trace.tools.map { t ->
        ActivityStep(
            id = t.id,
            label = stepLabel(texts, t.name, t.status),
            target = t.target?.takeIf { it.isNotEmpty() }?.let(::truncateTarget),
            status = t.status,
            durationMs = if (t.status == "running") {
                t.startedAt?.let { maxOf(0L, now - it) }
            } else {
                t.durationMs
            },
            startedAt = t.startedAt
        )
    }

    // Yang terbaru dimulai; waktu sama atau tak diketahui: yang datang belakangan.
    var newest: TraceTool? = null
    for (t in running) {
        val best = newest
        if (best == null || (t.startedAt ?: Long.MIN_VALUE) >= (best.startedAt ?: Long.MIN_VALUE)) newest = t
    }
    val current = newest?.let {
        ActivityCurrent(
            label = stepLabel(texts, it.name, "running"),
            target = it.target?.takeIf { target -> target.isNotEmpty() }?.let(::truncateTarget),
            parallel = running.size
        )
    }

    val settled = trace.settled
    val end = trace.endedAt ?: if (settled) trace.lastEventAt ?: trace.startedAt else now
    val startedAt = trace.startedAt
    val elapsedMs = if (startedAt == null || end == null) 0L else maxOf(0L, end - startedAt)

    val label = when (phase) {
        ActivityPhase.Done -> texts["activity_summary_done"]
        ActivityPhase.Error -> texts["activity_summary_error"]
        ActivityPhase.Cancelled -> texts["activity_summary_cancelled"]
        else -> null
    }
    val summary = label?.let {
        buildList {
            add(it)
            add(formatElapsed(texts, elapsedMs))
            if (steps.isNotEmpty()) add(texts["activity_steps", steps.size])
        }.joinToString(texts["activity_separator"])
    }

    val reasoningSource = trace.reasoningSummary?.takeIf { it.trim().isNotEmpty() } ?: trace.reasoning
    return Activity(
        headline = headlineFrom(reasoningSource),
        phase = phase,
        current = current,
        stepCount = steps.size,
        hiddenCount = maxOf(0, steps.size - visibleSteps),
        elapsedMs = elapsedMs,
        steps = steps,
        summary = summary,
        needsAttention = trace.tools.any { it.status == "error" } ||
            (!settled && (trace.approvals.isNotEmpty() || trace.status == "waiting_approval"))
    )
}

/** Fase run dari jejaknya (tanpa membangun seluruh [Activity]); dipakai Orb di item jawaban, topbar, dan composer. */
fun RunTrace.phase(): ActivityPhase = phaseOf(this, tools.filter { it.status == "running" })
