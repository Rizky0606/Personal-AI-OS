package app.aios.android.ui.chat.activity

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.shareIn

private const val TICK_MS = 1_000L

/**
 * Satu sumber waktu bersama: satu coroutine yang mengirim waktu sekarang tiap [periodMs], dibagi ke semua
 * pelanggan. Hanya berjalan selama ada pelanggan (`WhileSubscribed`); tanpa pelanggan, tidak ada loop sama sekali.
 */
class SharedTicker(
    scope: CoroutineScope,
    periodMs: Long = TICK_MS,
    clock: () -> Long = System::currentTimeMillis
) {
    val now: SharedFlow<Long> = flow {
        while (true) {
            emit(clock())
            delay(periodMs)
        }
    }.shareIn(scope, SharingStarted.WhileSubscribed(stopTimeoutMillis = 0, replayExpirationMillis = 0), replay = 1)
}

/** Ticker proses ini: dipakai semua baris aktivitas yang terlihat. */
object ActivityClock {
    val ticker = SharedTicker(CoroutineScope(SupervisorJob() + Dispatchers.Default))
}

/**
 * Waktu sekarang (ms) yang diperbarui tiap detik, hanya selama layar terlihat: koleksi mengikuti lifecycle
 * (berhenti saat aplikasi di latar belakang atau layar mati). Panggil hanya untuk run yang belum selesai; baca
 * `.value` sedekat mungkin dengan teks timer supaya hanya teks itu yang digambar ulang.
 */
@Composable
fun rememberClockNow(): State<Long> = ActivityClock.ticker.now.collectAsStateWithLifecycle(
    initialValue = System.currentTimeMillis()
)
