package app.aios.android.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import app.aios.ui.tokens.AiosColors

/** Fase kerja agent (sama dengan desktop: idle, thinking, tool, writing, done, error). */
enum class AgentPhase { Idle, Thinking, Tool, Writing, Done, Error }

/** Warna satu fase: isi, latar lembut, dan teks di atas isi; semuanya dari token status. */
@Immutable
data class PhaseColors(val fg: Color, val soft: Color, val on: Color)

/** Pemetaan fase ke token status (idle memakai aksen). */
fun AiosColors.phase(phase: AgentPhase): PhaseColors = when (phase) {
    AgentPhase.Idle -> PhaseColors(accent, accentSoft, text)
    AgentPhase.Thinking -> PhaseColors(thinking, thinkingSoft, thinkingOn)
    AgentPhase.Tool -> PhaseColors(tool, toolSoft, toolOn)
    AgentPhase.Writing -> PhaseColors(writing, writingSoft, writingOn)
    AgentPhase.Done -> PhaseColors(done, doneSoft, doneOn)
    AgentPhase.Error -> PhaseColors(error, errorSoft, errorOn)
}

/** Fase yang sedang bekerja: indikatornya boleh berdenyut atau berputar (bila animasi diizinkan). */
val AgentPhase.isActive: Boolean
    get() = this == AgentPhase.Thinking || this == AgentPhase.Tool || this == AgentPhase.Writing
