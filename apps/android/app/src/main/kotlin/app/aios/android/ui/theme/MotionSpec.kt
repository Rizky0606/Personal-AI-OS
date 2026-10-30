package app.aios.android.ui.theme

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring as composeSpring
import androidx.compose.animation.core.tween as composeTween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import app.aios.ui.tokens.Tokens

/**
 * Satu-satunya sumber durasi, kurva, dan spring animasi (dari Tokens.Motion). Composable tidak boleh memanggil
 * `tween`/`spring` sendiri; ambil dari `AiosTheme.motion`.
 *
 * Bila pengguna mematikan animasi di sistem (`ANIMATOR_DURATION_SCALE` = 0), [animationsEnabled] bernilai false:
 * semua spec berhingga menjadi `snap()` (perubahan instan) dan animasi dekoratif tak berhingga tidak dijalankan
 * ([decorative] false). Perubahan status yang bermakna tetap terjadi, hanya tanpa gerak.
 */
@Immutable
class MotionSpec private constructor(val animationsEnabled: Boolean) {
    /** Animasi dekoratif (denyut, napas, berkilau) boleh berjalan. */
    val decorative: Boolean get() = animationsEnabled

    fun <T> tween(durationMs: Int, easing: Easing = Tokens.Motion.Easing): FiniteAnimationSpec<T> =
        if (animationsEnabled) composeTween(durationMs, easing = easing) else snap()

    fun <T> instant(): FiniteAnimationSpec<T> = tween(Tokens.Motion.InstantMs)

    fun <T> fast(): FiniteAnimationSpec<T> = tween(Tokens.Motion.FastMs)

    fun <T> base(): FiniteAnimationSpec<T> = tween(Tokens.Motion.BaseMs)

    fun <T> slow(): FiniteAnimationSpec<T> = tween(Tokens.Motion.SlowMs)

    fun <T> emphasis(): FiniteAnimationSpec<T> = tween(Tokens.Motion.EmphasisMs)

    /** Tween dengan kurva pegas token (sedikit melampaui target) untuk elemen yang masuk atau berpindah. */
    fun <T> overshoot(durationMs: Int = Tokens.Motion.EmphasisMs): FiniteAnimationSpec<T> =
        tween(durationMs, Tokens.Motion.Spring)

    /** Spring fisik untuk elemen yang berpindah posisi (penanda aktif, kartu). */
    fun <T> spring(): FiniteAnimationSpec<T> = if (animationsEnabled) {
        composeSpring(Tokens.Motion.SpringDampingRatio, Tokens.Motion.SpringStiffness)
    } else {
        snap()
    }

    /** Siklus tak berhingga; durasi tidak pernah di bawah `LoopMinMs`. Hanya dipakai bila [decorative]. */
    fun <T> loop(cycleMs: Int, mode: RepeatMode = RepeatMode.Reverse): InfiniteRepeatableSpec<T> = infiniteRepeatable(
        composeTween(cycleMs.coerceAtLeast(Tokens.Motion.LoopMinMs), easing = Tokens.Motion.Easing),
        mode
    )

    companion object {
        val Full = MotionSpec(animationsEnabled = true)
        val Reduced = MotionSpec(animationsEnabled = false)

        /** Dari `Settings.Global.ANIMATOR_DURATION_SCALE`: 0 (atau negatif) berarti animasi dimatikan. */
        fun forScale(animatorDurationScale: Float): MotionSpec = if (animatorDurationScale > 0f) Full else Reduced

        fun systemScale(context: Context): Float = runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        }.getOrDefault(1f)
    }
}

/** MotionSpec mengikuti pengaturan sistem dan diperbarui saat pengguna mengubahnya. Preview selalu penuh. */
@Composable
fun rememberMotionSpec(): MotionSpec {
    val context = LocalContext.current
    if (LocalInspectionMode.current) return MotionSpec.Full
    var spec by remember { mutableStateOf(MotionSpec.forScale(MotionSpec.systemScale(context))) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                spec = MotionSpec.forScale(MotionSpec.systemScale(context))
            }
        }
        context.contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            observer
        )
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    return spec
}

/**
 * Nilai yang berdenyut antara [initial] dan [target] selama animasi dekoratif diizinkan; bila animasi dimatikan
 * sistem, mengembalikan [rest] dan tidak menjalankan transisi apa pun.
 */
@Composable
fun rememberLoopFloat(
    initial: Float,
    target: Float,
    cycleMs: Int,
    rest: Float = target,
    label: String,
    mode: RepeatMode = RepeatMode.Reverse
): Float {
    val motion = AiosTheme.motion
    if (!motion.decorative) return rest
    val value by rememberInfiniteTransition(
        label = label
    ).animateFloat(initial, target, motion.loop(cycleMs, mode), label)
    return value
}
