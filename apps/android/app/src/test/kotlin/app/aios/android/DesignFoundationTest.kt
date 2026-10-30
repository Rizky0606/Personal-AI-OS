package app.aios.android

import androidx.compose.animation.core.SnapSpec
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.TweenSpec
import androidx.compose.material3.Shapes
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.ui.unit.Density
import app.aios.android.data.settings.ThemeMode
import app.aios.android.ui.components.NavBarItem
import app.aios.android.ui.components.OrbSizeCompact
import app.aios.android.ui.components.OrbSizeFull
import app.aios.android.ui.components.orbVisualOf
import app.aios.android.ui.components.selectedIndexOf
import app.aios.android.ui.components.shimmerStart
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTypography
import app.aios.android.ui.theme.MotionSpec
import app.aios.android.ui.theme.aiosShapes
import app.aios.android.ui.theme.isActive
import app.aios.android.ui.theme.isDarkTheme
import app.aios.android.ui.theme.onAccentFor
import app.aios.android.ui.theme.phase
import app.aios.android.ui.theme.toMaterial
import app.aios.ui.tokens.Tokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionSpecTest {
    @Test
    fun animatorScaleNolMematikanAnimasi_selainItuMenyala() {
        assertFalse(MotionSpec.forScale(0f).animationsEnabled)
        assertFalse(MotionSpec.forScale(-1f).animationsEnabled)
        assertTrue(MotionSpec.forScale(1f).animationsEnabled)
        assertTrue(MotionSpec.forScale(0.5f).animationsEnabled)
        assertTrue(MotionSpec.forScale(1f).decorative)
        assertFalse(MotionSpec.forScale(0f).decorative)
    }

    @Test
    fun durasiBernamaMengikutiToken() {
        val m = MotionSpec.Full
        assertEquals(Tokens.Motion.InstantMs, (m.instant<Float>() as TweenSpec).durationMillis)
        assertEquals(Tokens.Motion.FastMs, (m.fast<Float>() as TweenSpec).durationMillis)
        assertEquals(Tokens.Motion.BaseMs, (m.base<Float>() as TweenSpec).durationMillis)
        assertEquals(Tokens.Motion.SlowMs, (m.slow<Float>() as TweenSpec).durationMillis)
        assertEquals(Tokens.Motion.EmphasisMs, (m.emphasis<Float>() as TweenSpec).durationMillis)
        assertEquals(80, Tokens.Motion.InstantMs)
        assertEquals(320, Tokens.Motion.EmphasisMs)
    }

    @Test
    fun tweenMemakaiKurvaTokenDanOvershootMemakaiKurvaPegas() {
        val base = MotionSpec.Full.base<Float>() as TweenSpec
        assertSame(Tokens.Motion.Easing, base.easing)
        val overshoot = MotionSpec.Full.overshoot<Float>() as TweenSpec
        assertSame(Tokens.Motion.Spring, overshoot.easing)
        assertEquals(Tokens.Motion.EmphasisMs, overshoot.durationMillis)
    }

    @Test
    fun springMemakaiRasioDanKekakuanToken() {
        val spring = MotionSpec.Full.spring<Float>() as SpringSpec
        assertEquals(Tokens.Motion.SpringDampingRatio, spring.dampingRatio, 0f)
        assertEquals(Tokens.Motion.SpringStiffness, spring.stiffness, 0f)
    }

    @Test
    fun animasiDimatikan_semuaSpecBerhinggaMenjadiSnap() {
        val m = MotionSpec.Reduced
        assertTrue(m.fast<Float>() is SnapSpec)
        assertTrue(m.base<Float>() is SnapSpec)
        assertTrue(m.emphasis<Float>() is SnapSpec)
        assertTrue(m.overshoot<Float>() is SnapSpec)
        assertTrue(m.spring<Float>() is SnapSpec)
    }

    @Test
    fun siklusTakBerhinggaTidakPernahDiBawahBatasMinimum() {
        val short = MotionSpec.Full.loop<Float>(cycleMs = 200)
        assertEquals(Tokens.Motion.LoopMinMs, (short.animation as TweenSpec).durationMillis)
        val long = MotionSpec.Full.loop<Float>(cycleMs = 3600)
        assertEquals(3600, (long.animation as TweenSpec).durationMillis)
    }
}

class TokenMappingTest {
    private val density = Density(1f)

    private fun CornerBasedShape.radii(): List<Float> {
        val box = Size(200f, 200f)
        return listOf(topStart, topEnd, bottomEnd, bottomStart).map { it.toPx(box, density) }
    }

    @Test
    fun radiusTokenSemuaTingkat_8_12_16_24() {
        assertEquals(
            listOf(
                8f,
                12f,
                16f,
                24f
            ),
            listOf(Tokens.Radius.sm, Tokens.Radius.md, Tokens.Radius.lg, Tokens.Radius.xl).map {
                it.value
            }
        )
        val shapes: Shapes = aiosShapes()
        assertEquals(8f, (shapes.small as CornerBasedShape).radii().first(), 0f)
        assertEquals(12f, (shapes.medium as CornerBasedShape).radii().first(), 0f)
        assertEquals(16f, (shapes.large as CornerBasedShape).radii().first(), 0f)
        assertEquals(24f, (shapes.extraLarge as CornerBasedShape).radii().first(), 0f)
    }

    @Test
    fun warnaMaterialDiambilDariTokenTerangDanGelap() {
        for (dark in listOf(false, true)) {
            val colors = if (dark) Tokens.darkColors else Tokens.lightColors
            val onAccent = onAccentFor(colors, dark)
            val scheme = colors.toMaterial(dark, onAccent)
            assertEquals(colors.accent, scheme.primary)
            assertEquals(onAccent, scheme.onPrimary)
            assertEquals(colors.bg, scheme.background)
            assertEquals(colors.text, scheme.onSurface)
            assertEquals(colors.danger, scheme.error)
            assertEquals(colors.border, scheme.outlineVariant)
        }
        assertEquals(Tokens.lightColors.surface, onAccentFor(Tokens.lightColors, false))
        assertEquals(Tokens.darkColors.bg, onAccentFor(Tokens.darkColors, true))
    }

    @Test
    fun lapisanPermukaanBerurutanSurface1KeSurface3() {
        val c = Tokens.lightColors
        val scheme = c.toMaterial(false, onAccentFor(c, false))
        assertEquals(c.surface, scheme.surfaceContainerLowest)
        assertEquals(c.surface1, scheme.surfaceContainerLow)
        assertEquals(c.surface2, scheme.surfaceContainer)
        assertEquals(c.surface3, scheme.surfaceContainerHigh)
        assertEquals(c.surface3, scheme.surfaceContainerHighest)
        assertEquals(
            listOf(
                1f,
                2f,
                4f
            ),
            listOf(Tokens.Elevation.layer1, Tokens.Elevation.layer2, Tokens.Elevation.layer3).map {
                it.value
            }
        )
    }

    @Test
    fun modeTemaTerangGelapSistem() {
        assertFalse(isDarkTheme(ThemeMode.Light, systemDark = true))
        assertTrue(isDarkTheme(ThemeMode.Dark, systemDark = false))
        assertTrue(isDarkTheme(ThemeMode.System, systemDark = true))
        assertFalse(isDarkTheme(ThemeMode.System, systemDark = false))
    }

    @Test
    fun warnaFaseMemetakanTokenStatusDiKeduaTema() {
        for (c in listOf(Tokens.lightColors, Tokens.darkColors)) {
            assertEquals(c.thinking, c.phase(AgentPhase.Thinking).fg)
            assertEquals(c.toolSoft, c.phase(AgentPhase.Tool).soft)
            assertEquals(c.writingOn, c.phase(AgentPhase.Writing).on)
            assertEquals(c.done, c.phase(AgentPhase.Done).fg)
            assertEquals(c.error, c.phase(AgentPhase.Error).fg)
            assertEquals(c.accent, c.phase(AgentPhase.Idle).fg)
        }
        assertNotEquals(
            Tokens.lightColors.phase(AgentPhase.Thinking).fg,
            Tokens.darkColors.phase(AgentPhase.Thinking).fg
        )
        assertEquals(
            listOf(AgentPhase.Thinking, AgentPhase.Tool, AgentPhase.Writing),
            AgentPhase.entries.filter {
                it.isActive
            }
        )
    }

    @Test
    fun skalaTipografiMengikutiTokenDanFontGeist() {
        val type = AiosTypography.Default
        assertEquals(Tokens.Type.ui.fontSize, type.ui.fontSize)
        assertEquals(Tokens.Type.chat.lineHeight, type.chat.lineHeight)
        assertEquals(Tokens.Type.page.fontWeight, type.page.fontWeight)
        assertEquals("Geist", Tokens.FontFamilyName.Sans)
        assertEquals("Geist Mono", Tokens.FontFamilyName.Mono)
        assertNotEquals(type.ui.fontFamily, type.mono.fontFamily)
    }

    @Test
    fun tidakAdaWarnaTransparanTerpakaiSebagaiTokenStatus() {
        for (c in listOf(Tokens.lightColors, Tokens.darkColors)) {
            for (p in AgentPhase.entries) {
                assertNotEquals(Color.Unspecified, c.phase(p).fg)
                assertEquals(1f, c.phase(p).fg.alpha, 0f)
            }
        }
    }
}

class FoundationComponentsTest {
    @Test
    fun orbPerFaseMenentukanBentuk() {
        assertTrue(orbVisualOf(AgentPhase.Thinking).spinning)
        assertTrue(orbVisualOf(AgentPhase.Done).showCheck)
        assertTrue(orbVisualOf(AgentPhase.Error).showAlert)
        AgentPhase.entries.filter { it != AgentPhase.Thinking }.forEach { assertFalse(orbVisualOf(it).spinning) }
        assertTrue(orbVisualOf(AgentPhase.Writing).dotScale > orbVisualOf(AgentPhase.Tool).dotScale)
        assertTrue(orbVisualOf(AgentPhase.Tool).dotScale > orbVisualOf(AgentPhase.Idle).dotScale)
        assertEquals(28f, OrbSizeFull.value, 0f)
        assertEquals(16f, OrbSizeCompact.value, 0f)
    }

    @Test
    fun sapuanBerkilauBergerakDariKiriKeKanan() {
        assertTrue(shimmerStart(0f) < 0f)
        assertEquals(0f, shimmerStart(0.5f), 0f)
        assertTrue(shimmerStart(1f) > 0f)
    }

    @Test
    fun itemNavigasiTerpilihDicariDariKunci() {
        val items = listOf(NavBarItem("a", 1, "A"), NavBarItem("b", 2, "B"), NavBarItem("c", 3, "C"))
        assertEquals(1, selectedIndexOf(items, "b"))
        assertEquals(-1, selectedIndexOf(items, "chat/lain"))
    }
}
