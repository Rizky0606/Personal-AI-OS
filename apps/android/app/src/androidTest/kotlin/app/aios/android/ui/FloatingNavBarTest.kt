package app.aios.android.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.aios.android.R
import app.aios.android.ui.components.FloatingNavBar
import app.aios.android.ui.components.NavBarItem
import app.aios.android.ui.components.navItemTag
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.MotionSpec
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Tes UI bilah navigasi pil melayang (instrumentasi; dijalankan di emulator/perangkat). */
class FloatingNavBarTest {
    @get:Rule
    val compose = createComposeRule()

    private val items = listOf(
        NavBarItem("chat", R.drawable.ic_chat, "Chat"),
        NavBarItem("research", R.drawable.ic_research, "Riset"),
        NavBarItem("schedules", R.drawable.ic_schedule, "Jadwal")
    )

    private fun show(onSelect: (String) -> Unit = {}) {
        compose.setContent {
            // Animasi dimatikan: tes tidak menunggu spring penanda.
            AiosTheme(darkTheme = false, motion = MotionSpec.Reduced) {
                var selected by remember { mutableStateOf("chat") }
                FloatingNavBar(items, selected, onSelect = {
                    selected = it
                    onSelect(it)
                })
            }
        }
    }

    @Test
    fun semuaItemTampilDenganLabelDanItemAktifTerpilih() {
        show()
        items.forEach { compose.onNodeWithText(it.label).assertIsDisplayed() }
        compose.onNodeWithTag(navItemTag("chat")).assertIsSelected()
        compose.onNodeWithTag(navItemTag("research")).assertIsNotSelected()
    }

    @Test
    fun menekanItemMemanggilCallbackDenganKunciDanMemindahkanPilihan() {
        val picked = mutableListOf<String>()
        show { picked += it }
        compose.onNodeWithTag(navItemTag("research")).performClick()
        assertEquals(listOf("research"), picked)
        compose.onNodeWithTag(navItemTag("research")).assertIsSelected()
        compose.onNodeWithTag(navItemTag("chat")).assertIsNotSelected()
    }

    @Test
    fun areaSentuhMinimal48dpDanPeranTabUntukTalkBack() {
        show()
        items.forEach {
            val node = compose.onNodeWithTag(navItemTag(it.key))
            node.assertHeightIsAtLeast(48.dp)
            node.assertWidthIsAtLeast(48.dp)
            node.assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab))
        }
    }
}
