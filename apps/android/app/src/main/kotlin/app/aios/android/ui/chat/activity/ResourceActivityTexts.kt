package app.aios.android.ui.chat.activity

import android.content.res.Resources
import androidx.annotation.StringRes
import app.aios.android.R
import app.aios.android.ui.theme.AgentPhase

/** Teks aktivitas dari `strings_activity.xml` lewat nama kunci (sumber yang sama dengan tes paritas JVM). */
class ResourceActivityTexts(private val resources: Resources, private val packageName: String) : ActivityTexts {
    private val ids = HashMap<String, Int>()

    override fun get(key: String, vararg args: Any): String {
        val id = ids.getOrPut(key) { resources.getIdentifier(key, "string", packageName) }
        require(id != 0) { "string $key tidak ada" }
        return if (args.isEmpty()) resources.getString(id) else resources.getString(id, *args)
    }
}

/** Fase aktivitas → fase Orb (menunggu izin tampil seperti alat; dibatalkan seperti idle). */
fun ActivityPhase.toAgentPhase(): AgentPhase = when (this) {
    ActivityPhase.Idle, ActivityPhase.Cancelled -> AgentPhase.Idle
    ActivityPhase.Thinking -> AgentPhase.Thinking
    ActivityPhase.Tool, ActivityPhase.WaitingApproval -> AgentPhase.Tool
    ActivityPhase.Writing -> AgentPhase.Writing
    ActivityPhase.Done -> AgentPhase.Done
    ActivityPhase.Error -> AgentPhase.Error
}

@StringRes
fun ActivityPhase.labelRes(): Int = when (this) {
    ActivityPhase.Idle -> R.string.activity_phase_idle
    ActivityPhase.Thinking -> R.string.activity_phase_thinking
    ActivityPhase.Tool -> R.string.activity_phase_tool
    ActivityPhase.Writing -> R.string.activity_phase_writing
    ActivityPhase.WaitingApproval -> R.string.activity_phase_waiting_approval
    ActivityPhase.Done -> R.string.activity_phase_done
    ActivityPhase.Error -> R.string.activity_phase_error
    ActivityPhase.Cancelled -> R.string.activity_phase_cancelled
}

@StringRes
fun AgentPhase.orbDescriptionRes(): Int = when (this) {
    AgentPhase.Idle -> R.string.activity_orb_idle
    AgentPhase.Thinking -> R.string.activity_orb_thinking
    AgentPhase.Tool -> R.string.activity_orb_tool
    AgentPhase.Writing -> R.string.activity_orb_writing
    AgentPhase.Done -> R.string.activity_orb_done
    AgentPhase.Error -> R.string.activity_orb_error
}
