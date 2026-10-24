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
    bg = Color(0xFFFAFAF9),
    surface = Color(0xFFFFFFFF),
    surface2 = Color(0xFFF4F3F1),
    border = Color(0xFFE2E1DE),
    borderStrong = Color(0xFFCCCAC7),
    text = Color(0xFF1C1A15),
    text2 = Color(0xFF57554F),
    text3 = Color(0xFF706E69),
    accent = Color(0xFFC65102),
    accentSoft = Color(0xFFFFE7D9),
    success = Color(0xFF3B9555),
    warning = Color(0xFFDFA11A),
    danger = Color(0xFFD33B36),
    info = Color(0xFF2B88C0),
  )

  val darkColors = AiosColors(
    bg = Color(0xFF100F0D),
    surface = Color(0xFF171613),
    surface2 = Color(0xFF201F1C),
    border = Color(0xFF2F2E2A),
    borderStrong = Color(0xFF43423F),
    text = Color(0xFFECEBE7),
    text2 = Color(0xFFA6A4A0),
    text3 = Color(0xFF878682),
    accent = Color(0xFFEE8545),
    accentSoft = Color(0xFF462312),
    success = Color(0xFF62BB78),
    warning = Color(0xFFEDB345),
    danger = Color(0xFFEF675C),
    info = Color(0xFF5EADE2),
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
