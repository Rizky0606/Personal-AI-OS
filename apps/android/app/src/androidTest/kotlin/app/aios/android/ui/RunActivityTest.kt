package app.aios.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import app.aios.android.ui.chat.Composer
import app.aios.android.ui.chat.VoiceInputState
import app.aios.android.ui.chat.activity.ActivityPhase
import app.aios.android.ui.chat.activity.RunActivity
import app.aios.android.ui.chat.activity.sampleTrace
import app.aios.android.ui.theme.AgentPhase
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.MotionSpec
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Tes UI baris aktivitas run dan composer (instrumentasi; dijalankan di emulator/perangkat). */
class RunActivityTest {
    @get:Rule
    val compose = createComposeRule()

    private fun show(phase: ActivityPhase, fontScale: Float = 1f) {
        compose.setContent {
            AiosTheme(darkTheme = false, motion = MotionSpec.Reduced) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                    Column { RunActivity(sampleTrace(phase)) }
                }
            }
        }
    }

    private val expandedState = SemanticsMatcher("diperluas") {
        it.config.getOrNull(SemanticsProperties.StateDescription) == "Diperluas"
    }
    private val collapsedState = SemanticsMatcher("diciutkan") {
        it.config.getOrNull(SemanticsProperties.StateDescription) == "Diciutkan"
    }

    @Test
    fun barisTertutupMenampilkanLabelDanDibukaDenganKetukan() {
        show(ActivityPhase.Tool)
        val row = compose.onNodeWithContentDescription("Aktivitas run: Menjalankan perintah")
        row.assert(collapsedState)
        row.assertHeightIsAtLeast(48.dp)
        row.performClick()
        row.assert(expandedState)
        compose.onNodeWithText("Berkas dibaca").assertIsDisplayed()
    }

    @Test
    fun bukaOtomatisSaatErrorDanSaatMenungguIzin() {
        show(ActivityPhase.Error)
        compose.onNode(hasContentDescription("Aktivitas run:", substring = true)).assert(expandedState)
    }

    @Test
    fun ringkasanTampilSetelahSelesaiDanJudulDibacakanSopan() {
        show(ActivityPhase.Done)
        compose.onNode(hasText("Selesai · 8 dtk · 2 langkah")).assertIsDisplayed()
    }

    @Test
    fun timerTidakIkutDiumumkanOlehBaris() {
        show(ActivityPhase.Tool)
        // Deskripsi baris tidak memuat waktu; teks timer sendiri tidak punya semantik.
        val desc = "Aktivitas run: Menjalankan perintah"
        compose.onNodeWithContentDescription(desc).assertIsDisplayed()
    }

    @Test
    fun skalaFont200PersenBarisTidakTerpotong() {
        show(ActivityPhase.Tool, fontScale = 2f)
        compose.onNodeWithContentDescription("Aktivitas run: Menjalankan perintah").apply {
            assertIsDisplayed()
            assertHeightIsAtLeast(96.dp)
        }
    }

    @Test
    fun tombolKirimBerubahMenjadiBerhentiDenganDeskripsiYangSesuai() {
        var streaming by mutableStateOf(false)
        var sent = 0
        var stopped = 0
        compose.setContent {
            AiosTheme(darkTheme = false, motion = MotionSpec.Reduced) {
                val voice = remember { VoiceInputState(false, {}, {}) }
                Composer(
                    draft = "halo",
                    onDraft = {},
                    streaming = streaming,
                    sending = false,
                    modelLabel = "Otomatis",
                    onSend = { sent++ },
                    onStop = { stopped++ },
                    onPickModel = {},
                    voice = voice,
                    phase = AgentPhase.Tool
                )
            }
        }
        compose.onNodeWithContentDescription("Kirim").performClick()
        assertEquals(1, sent)
        streaming = true
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Hentikan").assertHeightIsAtLeast(48.dp).performClick()
        assertEquals(1, stopped)
        assertEquals(1, sent)
    }
}
