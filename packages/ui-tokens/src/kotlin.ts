import { toHex } from './color.js';
import { GENERATED_NOTICE } from './css.js';
import { COLOR_NAMES, TYPE_ROLES, type ColorName, type Tokens } from './tokens.js';

export const KOTLIN_PACKAGE = 'app.aios.ui.tokens';

const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const num = (n: number) => String(Math.round(n * 10) / 10);
const float = (n: number) => `${n}f`;

const WEIGHTS: Record<number, string> = { 400: 'Normal', 500: 'Medium', 600: 'SemiBold' };

function colorsBlock(tokens: Tokens, theme: 'light' | 'dark'): string {
  const fields = COLOR_NAMES.map(
    (n: ColorName) => `    ${camel(n)} = Color(0xFF${toHex(tokens.color[theme][n])}),`,
  );
  return `  val ${theme}Colors = AiosColors(\n${fields.join('\n')}\n  )`;
}

/** Objek Kotlin untuk Compose: warna sRGB hasil konversi dari OKLCH, ukuran dalam dp dan sp. */
export function generateKotlin(tokens: Tokens): string {
  const colorFields = COLOR_NAMES.map((n) => `  val ${camel(n)}: Color,`).join('\n');
  const typeLines = TYPE_ROLES.map((role) => {
    const s = tokens.type[role].android;
    return `    val ${role} = AiosTextStyle(${num(s.size)}.sp, ${num(s.size * s.lineHeight)}.sp, FontWeight.${WEIGHTS[s.weight]})`;
  }).join('\n');
  const spaceLines = tokens.space.map((s) => `    val s${s} = ${s}.dp`).join('\n');
  const r = tokens.radius.android;
  const m = tokens.motion;

  return `// ${GENERATED_NOTICE}
@file:Suppress("unused")

package ${KOTLIN_PACKAGE}

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class AiosColors(
${colorFields}
)

data class AiosTextStyle(
  val fontSize: TextUnit,
  val lineHeight: TextUnit,
  val fontWeight: FontWeight,
)

object Tokens {
${colorsBlock(tokens, 'light')}

${colorsBlock(tokens, 'dark')}

  object FontFamilyName {
    const val Sans = "${tokens.font.family.sans}"
    const val Mono = "${tokens.font.family.mono}"
  }

  object Type {
${typeLines}
  }

  object Space {
${spaceLines}
  }

  object Radius {
    val sm = ${r.sm}.dp
    val md = ${r.md}.dp
    val lg = ${r.lg}.dp
    val full = 9999.dp
  }

  /** Satu elevasi untuk menu, popover, dialog, dan toast. Panel tidak berbayang. */
  val elevation = ${tokens.shadow.androidElevation}.dp

  object Motion {
    const val FastMs = ${m.duration.fast}
    const val BaseMs = ${m.duration.base}
    const val SlowMs = ${m.duration.slow}
    val Easing = CubicBezierEasing(${m.easing.map(float).join(', ')})
  }

  object Focus {
    val width = ${tokens.focus.width}.dp
    val offset = ${tokens.focus.offset}.dp
  }

  val touchTarget = ${tokens.layout.android.touchTarget}.dp
  const val ChatMeasureChars = ${tokens.layout.chatMeasureCh}
}
`;
}
