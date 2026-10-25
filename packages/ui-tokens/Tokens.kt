// GENERATED oleh packages/ui-tokens dari tokens.json. Jangan diedit tangan; jalankan pnpm --filter @aios/ui-tokens build.
@file:Suppress("unused")

package app.aios.ui.tokens

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class AiosColors(
  val bg: Color,
  val surface: Color,
  val surface2: Color,
  val border: Color,
  val borderStrong: Color,
  val text: Color,
  val text2: Color,
  val text3: Color,
  val accent: Color,
  val accentSoft: Color,
  val success: Color,
  val warning: Color,
  val danger: Color,
  val info: Color,
)

data class AiosTextStyle(
  val fontSize: TextUnit,
  val lineHeight: TextUnit,
  val fontWeight: FontWeight,
)

object Tokens {
  val lightColors = AiosColors(
    bg = Color(0xFFF5F8FC),
    surface = Color(0xFFFFFFFF),
    surface2 = Color(0xFFEDF2F8),
    border = Color(0xFFD8E0EA),
    borderStrong = Color(0xFFBCC7D6),
    text = Color(0xFF0F172A),
    text2 = Color(0xFF475569),
    text3 = Color(0xFF5D6B80),
    accent = Color(0xFF0D7490),
    accentSoft = Color(0xFFD4F3FB),
    success = Color(0xFF047857),
    warning = Color(0xFFB7791F),
    danger = Color(0xFFB91C1C),
    info = Color(0xFF0F766E),
  )

  val darkColors = AiosColors(
    bg = Color(0xFF0B1326),
    surface = Color(0xFF131B2E),
    surface2 = Color(0xFF222A3D),
    border = Color(0xFF2D3449),
    borderStrong = Color(0xFF3D4A5F),
    text = Color(0xFFDAE2FD),
    text2 = Color(0xFFBCC9CD),
    text3 = Color(0xFF8D9AA8),
    accent = Color(0xFF4CD7F6),
    accentSoft = Color(0xFF103A4A),
    success = Color(0xFF4EDEA3),
    warning = Color(0xFFF5C451),
    danger = Color(0xFFFFB4AB),
    info = Color(0xFF4EDBC8),
  )

  object FontFamilyName {
    const val Sans = "IBM Plex Sans"
    const val Mono = "IBM Plex Mono"
  }

  object Type {
    val caption = AiosTextStyle(12.sp, 16.8.sp, FontWeight.Normal)
    val meta = AiosTextStyle(13.sp, 18.2.sp, FontWeight.Normal)
    val ui = AiosTextStyle(14.sp, 20.3.sp, FontWeight.Normal)
    val chat = AiosTextStyle(16.sp, 25.6.sp, FontWeight.Normal)
    val section = AiosTextStyle(18.sp, 23.4.sp, FontWeight.SemiBold)
    val page = AiosTextStyle(22.sp, 27.5.sp, FontWeight.SemiBold)
  }

  object Space {
    val s4 = 4.dp
    val s8 = 8.dp
    val s12 = 12.dp
    val s16 = 16.dp
    val s20 = 20.dp
    val s24 = 24.dp
    val s32 = 32.dp
    val s40 = 40.dp
    val s48 = 48.dp
  }

  object Radius {
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val full = 9999.dp
  }

  /** Satu elevasi untuk menu, popover, dialog, dan toast. Panel tidak berbayang. */
  val elevation = 6.dp

  object Motion {
    const val FastMs = 120
    const val BaseMs = 180
    const val SlowMs = 240
    const val EmphasisMs = 320
    val Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val Spring = CubicBezierEasing(0.34f, 1.32f, 0.64f, 1f)
  }

  object Focus {
    val width = 2.dp
    val offset = 2.dp
  }

  val touchTarget = 48.dp
  const val ChatMeasureChars = 72
}
