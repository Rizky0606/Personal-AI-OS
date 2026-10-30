package app.aios.android.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

/** Satu tujuan di bilah navigasi: [key] unik (mis. rute), ikon, dan label yang juga dibacakan TalkBack. */
data class NavBarItem(val key: String, @DrawableRes val icon: Int, val label: String)

/** Indeks item terpilih; -1 bila [selectedKey] bukan salah satu item (penanda disembunyikan). */
internal fun selectedIndexOf(items: List<NavBarItem>, selectedKey: String): Int =
    items.indexOfFirst { it.key == selectedKey }

const val FLOATING_NAV_TAG = "floating_nav"

/** Tag uji untuk satu item bilah navigasi. */
fun navItemTag(key: String) = "nav_item_$key"

private val InnerPadding = 4.dp
private val BarMaxWidth = 480.dp
private val ItemHeight = 56.dp

/**
 * Bilah navigasi pil melayang. Penanda aktif meluncur antar item dengan spring dari MotionSpec (instan bila
 * animasi dimatikan sistem). Tiap item: ikon + label, tinggi 56 dp (di atas target sentuh 48 dp), peran Tab
 * dengan status terpilih untuk TalkBack. Bilah memberi ruang untuk insets sistem; dipasang di slot `bottomBar`
 * Scaffold supaya konten tidak tertutup.
 */
@Composable
fun FloatingNavBar(
    items: List<NavBarItem>,
    selectedKey: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = AiosTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.full)
    val selectedIndex = selectedIndexOf(items, selectedKey)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = Tokens.Space.s16, vertical = Tokens.Space.s8),
        contentAlignment = Alignment.Center
    ) {
        BoxWithConstraints(
            modifier = Modifier
                .widthIn(max = BarMaxWidth)
                .fillMaxWidth()
                .testTag(FLOATING_NAV_TAG)
                .shadow(Tokens.elevation, shape)
                .background(colors.surface2, shape)
                .border(Hairline, colors.border, shape)
                .padding(InnerPadding)
        ) {
            val itemWidth = maxWidth / items.size.coerceAtLeast(1)
            val indicatorX by animateDpAsState(
                targetValue = itemWidth * selectedIndex.coerceAtLeast(0),
                animationSpec = AiosTheme.motion.spring(),
                label = "navIndicator"
            )
            if (selectedIndex >= 0) {
                Box(
                    modifier = Modifier
                        .offset(x = indicatorX)
                        .width(itemWidth)
                        .height(ItemHeight)
                        .background(colors.accentSoft, shape)
                )
            }
            Row(modifier = Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.Start) {
                items.forEach { item ->
                    NavBarButton(
                        item = item,
                        selected = item.key == selectedKey,
                        onClick = { onSelect(item.key) },
                        modifier = Modifier.width(itemWidth)
                    )
                }
            }
        }
    }
}

@Composable
private fun NavBarButton(item: NavBarItem, selected: Boolean, onClick: () -> Unit, modifier: Modifier) {
    val colors = AiosTheme.colors
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val tint = if (selected) colors.text else colors.text2
    Column(
        modifier = modifier
            .height(ItemHeight)
            .testTag(navItemTag(item.key))
            .focusRing(focused, colors.accent, Tokens.Radius.full)
            .clip(RoundedCornerShape(Tokens.Radius.full))
            .selectable(
                selected = selected,
                interactionSource = source,
                indication = null,
                role = Role.Tab,
                onClick = onClick
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        AiosIcon(item.icon, contentDescription = null, tint = tint)
        Text(text = item.label, style = AiosTheme.type.caption, color = tint)
    }
}
