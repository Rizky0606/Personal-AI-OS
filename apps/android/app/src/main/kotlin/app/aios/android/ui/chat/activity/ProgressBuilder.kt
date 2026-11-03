package app.aios.android.ui.chat.activity

import app.aios.android.data.api.ConversationProgress
import app.aios.android.data.api.ProgressOutput
import app.aios.android.data.realtime.TodoPhase

/*
 * Port Kotlin murni (tanpa Android API) dari apps/desktop/src/realtime/progress.ts: menggabungkan agregat
 * tersimpan (GET /conversations/:id/progress) dengan run yang sedang mengalir (RunTrace) tanpa duplikasi.
 * Hasilnya sama persis dengan fixture emas packages/contracts/fixtures/progress (dipakai desktop di P2B).
 */

enum class StepState { Done, Active, Pending, Blocked, Abandoned }

data class ProgressStep(
    val id: String,
    val label: String,
    val state: StepState,
    /** Alasan langkah terhambat (status blocked) atau gagal (langkah turunan dari tool yang galat). */
    val blocker: String? = null,
    /** Nama tahap; hanya pada langkah pertama sebuah tahap, dan hanya bila ada lebih dari satu tahap. */
    val phase: String? = null
)

data class ProgressChip(
    /** Nomor langkah yang sedang dikerjakan (mulai 1). */
    val current: Int,
    /** Total langkah rencana; null bila tidak ada rencana (mesin tanpa tool todo): tidak pernah dikarang. */
    val total: Int?,
    val label: String
)

/** Jenis alat yang ditampilkan di "Digunakan dalam sesi ini". */
enum class ToolGroup { Web, Browser, Terminal, Files, Subagent }

data class ProgressUsed(
    val uploads: List<Pair<String, String>> = emptyList(),
    val skills: List<String> = emptyList(),
    val memoryRead: Int = 0,
    val memoryItems: List<Pair<String, String>> = emptyList(),
    val engine: String? = null,
    val model: String? = null,
    val tools: List<ToolGroup> = emptyList(),
    val connectors: List<String> = emptyList()
)

data class ProgressView(
    val hasPlan: Boolean,
    val steps: List<ProgressStep>,
    val chip: ProgressChip?,
    val outputs: List<ProgressOutput>,
    val used: ProgressUsed
)

private val TOOL_GROUP: Map<ToolKind, ToolGroup> = mapOf(
    ToolKind.Web to ToolGroup.Web,
    ToolKind.Browser to ToolGroup.Browser,
    ToolKind.Command to ToolGroup.Terminal,
    ToolKind.Read to ToolGroup.Files,
    ToolKind.Edit to ToolGroup.Files,
    ToolKind.Search to ToolGroup.Files,
    ToolKind.Subagent to ToolGroup.Subagent
)
private val TOOL_GROUP_ORDER = listOf(
    ToolGroup.Web,
    ToolGroup.Browser,
    ToolGroup.Terminal,
    ToolGroup.Files,
    ToolGroup.Subagent
)

private fun <T, K> union(base: List<T>, extra: List<T>, key: (T) -> K): List<T> {
    val seen = base.map(key).toHashSet()
    return base + extra.filterNot { seen.contains(key(it)) }
}

private fun stepStateOf(status: String): StepState = when (status) {
    "completed" -> StepState.Done
    "in_progress" -> StepState.Active
    "blocked" -> StepState.Blocked
    "abandoned" -> StepState.Abandoned
    else -> StepState.Pending
}

private fun planSteps(phases: List<TodoPhase>): List<ProgressStep> {
    val named = phases.size > 1
    return phases.flatMapIndexed { p, phase ->
        phase.tasks.mapIndexed { t, task ->
            ProgressStep(
                id = "p$p-$t",
                label = task.content,
                state = stepStateOf(task.status),
                blocker = task.blocker,
                phase = if (named && t == 0 && phase.name.isNotEmpty()) phase.name else null
            )
        }
    }
}

/** Langkah turunan dari langkah tool (mesin tanpa rencana): label kalimat langkah, target redup lewat id. */
private fun derivedSteps(steps: List<ActivityStep>): List<ProgressStep> = steps.map { step ->
    val state = when (step.status) {
        "running" -> StepState.Active
        "ok" -> StepState.Done
        "error" -> StepState.Blocked
        else -> StepState.Abandoned
    }
    ProgressStep(
        id = step.id,
        label = if (step.target != null) "${step.label} ${step.target}" else step.label,
        state = state,
        blocker = if (step.status == "error") step.label else null
    )
}

private fun chipOf(steps: List<ProgressStep>, hasPlan: Boolean): ProgressChip? {
    if (steps.isEmpty()) return null
    if (!hasPlan) return ProgressChip(steps.size, null, steps.last().label)
    val active = steps.indexOfFirst { it.state == StepState.Active }
    val blocked = steps.indexOfFirst { it.state == StepState.Blocked }
    val settled = steps.count { it.state == StepState.Done || it.state == StepState.Abandoned }
    val index = if (active >= 0) active else if (blocked >= 0) blocked else minOf(settled, steps.size - 1)
    return ProgressChip(index + 1, steps.size, steps[index].label)
}

/** Setara `buildProgress(response, live, now, options)` di desktop. [now] dalam ms epoch. */
fun buildProgress(
    response: ConversationProgress?,
    trace: RunTrace?,
    runId: String?,
    now: Long,
    texts: ActivityTexts,
    savedTools: List<TraceTool> = emptyList()
): ProgressView {
    // Rencana: yang dari run yang sedang mengalir lebih baru daripada yang tersimpan.
    val phases = if (trace?.todos?.isNotEmpty() == true) trace.todos else response?.plan?.phases.orEmpty()
    val hasPlan = phases.any { it.tasks.isNotEmpty() }
    val steps = if (hasPlan) {
        planSteps(phases)
    } else {
        val forActivity = trace ?: RunTrace(tools = savedTools)
        derivedSteps(buildActivity(forActivity, now, texts).steps)
    }

    // Hasil kerja: artifact yang baru tiba di run live (belum ada di agregat) berada paling atas.
    val stored = response?.outputs.orEmpty()
    val storedFileIds = stored.mapNotNull {
        when (it) {
            is ProgressOutput.Image -> it.fileId
            is ProgressOutput.FileOutput -> it.fileId
            else -> null
        }
    }.toHashSet()
    val fresh = (trace?.artifacts.orEmpty())
        .filterNot { storedFileIds.contains(it.fileId) }
        .reversed()
        .map { a ->
            val at = java.time.Instant.ofEpochMilli(now).toString()
            val outRunId = runId.orEmpty()
            if (isRasterImageMime(a.mime)) {
                ProgressOutput.Image(outRunId, at, a.fileId, a.name, a.mime, a.size)
            } else {
                ProgressOutput.FileOutput(outRunId, at, a.fileId, a.name, a.mime, a.size)
            }
        }
    val outputs = fresh + stored

    // Digunakan: gabungan tersimpan dan live; engine, model, dan memori mengikuti run terbaru.
    val context = trace?.context
    val base = response?.used
    val toolNames = union(
        base?.tools.orEmpty(),
        (trace?.tools.orEmpty()).map { it.name }.filter { it.isNotEmpty() }
    ) { it }
    val groups = linkedSetOf<ToolGroup>()
    val connectors = mutableListOf<String>()
    for (name in toolNames) {
        if (name.startsWith("mcp__")) {
            connectors += name.split("__").getOrNull(1) ?: name
            continue
        }
        val kind = kindOf(name)
        val group = kind?.let { TOOL_GROUP[it] }
        if (group != null) groups += group
    }
    val uploads = union(
        base?.attachments.orEmpty().map { it.fileId to it.name },
        context?.attachments.orEmpty().map { it.fileId to it.name }
    ) { it.first }
    val memoryItems = context?.memory?.items?.map { it.id to it.title }
        ?: base?.memory?.items?.map { it.id to it.title }.orEmpty()
    val used = ProgressUsed(
        uploads = uploads,
        skills = union(base?.skills.orEmpty(), context?.skills.orEmpty()) { it },
        memoryRead = context?.memory?.read ?: base?.memory?.read ?: 0,
        memoryItems = memoryItems,
        engine = context?.engine ?: base?.engine,
        model = context?.model ?: base?.model,
        tools = TOOL_GROUP_ORDER.filter { groups.contains(it) },
        connectors = connectors.distinct()
    )

    return ProgressView(hasPlan = hasPlan, steps = steps, chip = chipOf(steps, hasPlan), outputs = outputs, used = used)
}

/** Sama dengan @aios/contracts `isRasterImageMime`: PNG/JPEG/WebP/GIF dianggap gambar; SVG bukan. */
private fun isRasterImageMime(mime: String): Boolean =
    mime.lowercase() in setOf("image/png", "image/jpeg", "image/webp", "image/gif")
