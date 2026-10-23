package app.aios.android.data.api

import kotlinx.serialization.Serializable

/* Model riset mengikuti packages/contracts (entities.ts, api-schemas.ts). Ubah bersama kontrak. */

const val RESEARCH_QUICK = "quick"
const val RESEARCH_STANDARD = "standard"
const val RESEARCH_DEEP = "deep"

/** Status job yang berarti tidak akan berubah lagi. */
val TERMINAL_RESEARCH_STATUSES = setOf("completed", "failed", "cancelled")

@Serializable
data class ResearchPlan(val subQuestions: List<String> = emptyList())

@Serializable
data class ResearchJob(
    val id: String,
    val question: String,
    val depth: String,
    val status: String,
    val plan: ResearchPlan? = null,
    val reportMd: String? = null,
    val runId: String? = null,
    val createdAt: String,
    val updatedAt: String
) {
    val running: Boolean get() = status == "queued" || status == "running"
}

@Serializable
data class ResearchSource(
    val id: String,
    val jobId: String,
    val url: String,
    val title: String,
    val fetchedAt: String? = null,
    val used: Boolean = false
)

@Serializable
data class ResearchJobDetail(
    val id: String,
    val question: String,
    val depth: String,
    val status: String,
    val plan: ResearchPlan? = null,
    val reportMd: String? = null,
    val runId: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val sources: List<ResearchSource> = emptyList()
) {
    val job: ResearchJob
        get() = ResearchJob(id, question, depth, status, plan, reportMd, runId, createdAt, updatedAt)
}

@Serializable
data class CreateResearchRequest(val question: String, val depth: String)
