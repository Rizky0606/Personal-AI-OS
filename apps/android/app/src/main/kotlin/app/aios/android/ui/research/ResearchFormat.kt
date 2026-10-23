package app.aios.android.ui.research

import java.time.Instant
import java.time.ZoneId

/** Satu sumber dari bagian "Daftar sumber" di laporan. [n] adalah nomor rujukan `[n]` di isi laporan. */
data class ReportSource(val n: Int, val title: String, val url: String, val meta: String)

data class ParsedReport(val bodyMd: String, val sources: List<ReportSource>) {
    /** Peta nomor rujukan ke URL, untuk membuat `[n]` di isi laporan bisa diketuk. */
    val citations: Map<Int, String> get() = sources.associate { it.n to it.url }
}

/**
 * Server menyusun laporan dengan rujukan `[n]` yang dinomori ulang menurut kemunculan, diakhiri bagian
 * `## Daftar sumber` berisi `- [n] [Judul](url) — domain, diakses tanggal`. Nomor itu mengacu ke daftar di
 * laporan sendiri, bukan ke urutan `sources` di API, jadi daftar inilah yang diurai.
 */
object ReportParser {
    private val headingRe = Regex("""(?im)^##\s+daftar sumber\s*$""")
    private val itemRe = Regex("""^\s*[-*]\s+\[(\d{1,3})]\s+\[(.*)]\((\S+?)\)(?:\s+[—-]\s+(.*))?\s*$""")

    fun parse(markdown: String): ParsedReport {
        val heading = headingRe.find(markdown) ?: return ParsedReport(markdown.trimEnd(), emptyList())
        val body = markdown.substring(0, heading.range.first).trimEnd()
        val sources = markdown.substring(heading.range.last + 1).lineSequence().mapNotNull { line ->
            val m = itemRe.matchEntire(line) ?: return@mapNotNull null
            val url = m.groupValues[3].replace("%28", "(").replace("%29", ")").replace("%20", " ")
            if (!(url.startsWith("https://") || url.startsWith("http://"))) return@mapNotNull null
            ReportSource(m.groupValues[1].toInt(), m.groupValues[2].trim(), url, m.groupValues[4].trim())
        }.toList()
        return ParsedReport(body, sources)
    }
}

/** Tahap riset dari event `research.progress`, urut dari awal. */
val RESEARCH_STAGES = listOf("planning", "searching", "reading", "writing")

sealed interface RelativeTime {
    data object JustNow : RelativeTime

    data class Minutes(val n: Long) : RelativeTime

    data class Hours(val n: Long) : RelativeTime

    /** Tanggal lengkap, mis. "22 Okt 2026". */
    data class Date(val text: String) : RelativeTime

    companion object {
        private val months = listOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")
        private const val MS_PER_MINUTE = 60_000L
        private const val MINUTES_PER_HOUR = 60L
        private const val HOURS_PER_DAY = 24L

        fun of(iso: String, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): RelativeTime {
            val then = runCatching { Instant.parse(iso) }.getOrNull() ?: return Date(iso.take(DATE_LENGTH))
            val minutes = (nowMs - then.toEpochMilli()) / MS_PER_MINUTE
            return when {
                minutes < 1 -> JustNow
                minutes < MINUTES_PER_HOUR -> Minutes(minutes)
                minutes < MINUTES_PER_HOUR * HOURS_PER_DAY -> Hours(minutes / MINUTES_PER_HOUR)
                else -> then.atZone(
                    zone
                ).toLocalDate().let { Date("${it.dayOfMonth} ${months[it.monthValue - 1]} ${it.year}") }
            }
        }

        private const val DATE_LENGTH = 10
    }
}
