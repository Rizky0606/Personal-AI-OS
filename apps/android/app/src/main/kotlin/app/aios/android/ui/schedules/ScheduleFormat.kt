package app.aios.android.ui.schedules

import java.time.DateTimeException
import java.time.Instant
import java.time.ZoneId

/** Format waktu jadwal dalam zona waktu jadwalnya, mis. "Sen, 26 Okt 07.00 WIB". Murni, tanpa Android. */
object ScheduleFormat {
    private val days = listOf("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min")
    private val months = listOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")

    fun zoneLabel(zone: String): String = when (zone) {
        "Asia/Jakarta" -> "WIB"
        "Asia/Makassar" -> "WITA"
        "Asia/Jayapura" -> "WIT"
        else -> zone
    }

    /** Null atau tanggal rusak menghasilkan null; pemanggil menampilkan teks "tidak dijadwalkan". */
    fun instant(iso: String?, zone: String): String? {
        iso ?: return null
        return try {
            val at = Instant.parse(iso).atZone(ZoneId.of(zone))
            val hh = at.hour.toString().padStart(2, '0')
            val mm = at.minute.toString().padStart(2, '0')
            "${days[at.dayOfWeek.value - 1]}, ${at.dayOfMonth} ${months[at.monthValue - 1]} $hh.$mm ${zoneLabel(zone)}"
        } catch (_: DateTimeException) {
            null
        }
    }

}
