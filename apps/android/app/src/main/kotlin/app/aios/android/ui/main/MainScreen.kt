package app.aios.android.ui.main

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import app.aios.android.link.AppLink
import app.aios.android.push.NotificationPrompt
import app.aios.android.ui.schedules.ScheduleCreateScreen
import app.aios.android.ui.schedules.ScheduleDetailScreen
import app.aios.android.ui.schedules.ScheduleListScreen
import androidx.compose.foundation.layout.Column
import androidx.navigation.navArgument
import app.aios.android.ui.research.ResearchDetailScreen
import app.aios.android.ui.research.ResearchFormScreen
import app.aios.android.ui.research.ResearchListScreen
import app.aios.android.ui.chat.ChatEvent
import app.aios.android.ui.chat.ChatScreen
import app.aios.android.ui.chat.ChatViewModel
import app.aios.android.ui.chat.ConversationDrawer
import app.aios.android.ui.chat.ConversationsViewModel
import kotlinx.coroutines.launch
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.Role
import androidx.compose.material3.SnackbarHostState
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.aios.android.R
import app.aios.android.debug.DebugFeatures
import app.aios.android.debug.debugRoutes
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.AiosSnackbarHost
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.memory.MemoryScreen
import app.aios.android.ui.spaces.SpaceDetailScreen
import app.aios.android.ui.spaces.SpaceListScreen
import app.aios.android.ui.settings.SettingsScreen
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens

private object Routes {
    const val CHAT = "chat"
    const val RESEARCH = "research"
    const val RESEARCH_NEW = "research/new"
    const val RESEARCH_DETAIL = "research/{id}"
    const val SCHEDULES = "schedules"
    const val SCHEDULE_NEW = "schedules/new"
    const val SCHEDULE_DETAIL = "schedules/{id}"
    const val SPACES = "spaces"
    const val SPACE_DETAIL = "spaces/{id}"
    const val SETTINGS = "settings"
    const val MEMORY = "settings/memory"
}

private data class Tab(val route: String, @StringRes val label: Int, @DrawableRes val icon: Int)

private val tabs = listOf(
    Tab(Routes.CHAT, R.string.nav_chat, R.drawable.ic_chat),
    Tab(Routes.RESEARCH, R.string.nav_research, R.drawable.ic_research),
    Tab(Routes.SCHEDULES, R.string.nav_schedules, R.drawable.ic_schedule),
    Tab(Routes.SPACES, R.string.nav_spaces, R.drawable.ic_library)
)

/** Kerangka setelah login: top bar dengan ikon Pengaturan, konten, dan bottom nav 4 tab dengan indikator pil. */
/**
 * [sessionKey] (ID perangkat) membuat ViewModel chat baru untuk setiap sesi, sehingga percakapan
 * akun sebelumnya tidak terbawa setelah logout lalu login lagi.
 */
@Composable
fun MainScreen(online: Boolean, sessionKey: String, link: AppLink?, onLinkConsumed: () -> Unit) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: Routes.CHAT
    val isTab = tabs.any { it.route == route }
    val snackbar = remember { SnackbarHostState() }
    val transition = tween<Float>(Tokens.Motion.BaseMs, easing = Tokens.Motion.Easing)
    val chatVm: ChatViewModel = hiltViewModel(key = "chat-$sessionKey")
    val conversationsVm: ConversationsViewModel = hiltViewModel(key = "conversations-$sessionKey")
    val chatUi by chatVm.ui.collectAsStateWithLifecycle()
    val conversationsUi by conversationsVm.ui.collectAsStateWithLifecycle()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val onChat = route == Routes.CHAT
    val chatTitle = chatUi.title.ifBlank { stringResource(R.string.nav_chat) }

    // Tujuan dari share atau ketukan notifikasi. Teks dari share hanya mengisi composer; tidak pernah terkirim sendiri.
    LaunchedEffect(link) {
        val target = link ?: return@LaunchedEffect
        fun openChat() = nav.navigate(Routes.CHAT) {
            popUpTo(nav.graph.findStartDestination().id)
            launchSingleTop = true
        }
        when (target) {
            is AppLink.SharedText -> {
                chatVm.open(null)
                chatVm.onDraft(target.text)
                openChat()
            }
            is AppLink.OpenConversation -> {
                chatVm.open(target.conversationId)
                openChat()
            }
            AppLink.NewResearch -> nav.navigate(Routes.RESEARCH_NEW)
            AppLink.Assist -> {
                chatVm.open(null)
                chatVm.requestVoice()
                openChat()
            }
            is AppLink.OpenResearch -> nav.navigate("research/${target.researchId}")
            is AppLink.OpenSchedule -> nav.navigate("schedules/${target.scheduleId}")
        }
        onLinkConsumed()
    }

    LaunchedEffect(conversationsVm) {
        conversationsVm.events.collect { event ->
            if (event is ChatEvent.Notice) snackbar.showSnackbar(context.getString(event.message))
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = onChat,
        drawerContent = {
            ConversationDrawer(
                ui = conversationsUi,
                selectedId = chatUi.conversationId,
                online = online,
                onQuery = conversationsVm::onQuery,
                onArchivedMode = conversationsVm::setArchivedMode,
                onSelect = {
                    chatVm.open(it.id)
                    scope.launch { drawerState.close() }
                },
                onHistory = { hit ->
                    hit.conversationId?.let(chatVm::open)
                    hit.researchId?.let { nav.navigate("research/$it") }
                    scope.launch { drawerState.close() }
                },
                onNew = {
                    chatVm.open(null)
                    scope.launch { drawerState.close() }
                },
                onRetry = conversationsVm::refresh,
                onTogglePinned = conversationsVm::togglePinned,
                onSetArchived = { conversation, archived ->
                    conversationsVm.setArchived(conversation, archived)
                    if (archived && conversation.id == chatUi.conversationId) chatVm.open(null)
                },
                onDelete = {
                    conversationsVm.delete(it)
                    if (it.id == chatUi.conversationId) chatVm.open(null)
                }
            )
        }
    ) {
        Scaffold(
            containerColor = AiosTheme.colors.bg,
            topBar = {
                TopBar(
                    title = if (onChat) chatTitle else stringResource(titleFor(route)),
                    showBack = !isTab,
                    onBack = { nav.popBackStack() },
                    onSettings = { nav.navigate(Routes.SETTINGS) { launchSingleTop = true } },
                    showSettings = isTab,
                    onMenu = if (onChat) ({ scope.launch { drawerState.open() } }) else null
                )
            },
            bottomBar = { if (isTab) BottomBar(route, nav) },
            snackbarHost = { AiosSnackbarHost(snackbar) }
        ) { padding ->
            Column(modifier = Modifier.padding(padding)) {
                NotificationPrompt()
                NavHost(
                    navController = nav,
                    startDestination = Routes.CHAT,
                    modifier = Modifier.weight(1f),
                    enterTransition = { fadeIn(transition) },
                    exitTransition = { fadeOut(transition) },
                    popEnterTransition = { fadeIn(transition) },
                    popExitTransition = { fadeOut(transition) }
                ) {
                    composable(Routes.CHAT) { ChatScreen(chatVm, snackbar) }
                    composable(Routes.RESEARCH) {
                        ResearchListScreen(
                            online = online,
                            onNew = { nav.navigate(Routes.RESEARCH_NEW) },
                            onOpen = { nav.navigate("research/${it.id}") }
                        )
                    }
                    composable(Routes.RESEARCH_NEW) {
                        ResearchFormScreen(
                            onCreated = { id ->
                                nav.navigate("research/$id") { popUpTo(Routes.RESEARCH) }
                            }
                        )
                    }
                    composable(
                        route = Routes.RESEARCH_DETAIL,
                        arguments = listOf(navArgument("id") { type = NavType.StringType })
                    ) {
                        ResearchDetailScreen(
                            online = online,
                            snackbar = snackbar,
                            onOpenChat = { conversationId ->
                                chatVm.open(conversationId)
                                nav.navigate(Routes.CHAT) {
                                    popUpTo(nav.graph.findStartDestination().id)
                                    launchSingleTop = true
                                }
                            },
                            onNewResearch = { nav.navigate(Routes.RESEARCH_NEW) }
                        )
                    }
                    composable(Routes.SCHEDULES) {
                        ScheduleListScreen(
                            online = online,
                            snackbar = snackbar,
                            onNew = { nav.navigate(Routes.SCHEDULE_NEW) },
                            onOpen = { nav.navigate("schedules/${it.id}") }
                        )
                    }
                    composable(Routes.SCHEDULE_NEW) {
                        ScheduleCreateScreen(
                            online = online,
                            onCreated = { id -> nav.navigate("schedules/$id") { popUpTo(Routes.SCHEDULES) } }
                        )
                    }
                    composable(
                        route = Routes.SCHEDULE_DETAIL,
                        arguments = listOf(navArgument("id") { type = NavType.StringType })
                    ) {
                        ScheduleDetailScreen(
                            online = online,
                            snackbar = snackbar,
                            onOpenConversation = { conversationId ->
                                chatVm.open(conversationId)
                                nav.navigate(Routes.CHAT) {
                                    popUpTo(nav.graph.findStartDestination().id)
                                    launchSingleTop = true
                                }
                            },
                            onClosed = { nav.popBackStack(Routes.SCHEDULES, inclusive = false) }
                        )
                    }
                    composable(Routes.SPACES) {
                        SpaceListScreen(online = online, snackbar = snackbar, onOpen = { nav.navigate("spaces/$it") })
                    }
                    composable(
                        route = Routes.SPACE_DETAIL,
                        arguments = listOf(navArgument("id") { type = NavType.StringType })
                    ) {
                        SpaceDetailScreen(
                            online = online,
                            snackbar = snackbar,
                            onChat = { space ->
                                chatVm.openInSpace(space.id, space.name)
                                nav.navigate(Routes.CHAT) {
                                    popUpTo(nav.graph.findStartDestination().id)
                                    launchSingleTop = true
                                }
                            },
                            onDeleted = { nav.popBackStack(Routes.SPACES, inclusive = false) }
                        )
                    }
                    composable(Routes.SETTINGS) {
                        SettingsScreen(
                            onOpenCatalog = { nav.navigate(DebugFeatures.ROUTE) },
                            onOpenMemory = { nav.navigate(Routes.MEMORY) }
                        )
                    }
                    composable(Routes.MEMORY) { MemoryScreen(online = online, snackbar = snackbar) }
                    debugRoutes()
                }
            }
        }
    }
}

@StringRes
private fun titleFor(route: String): Int = when (route) {
    Routes.RESEARCH, Routes.RESEARCH_DETAIL -> R.string.nav_research
    Routes.RESEARCH_NEW -> R.string.research_form_title
    Routes.SCHEDULES, Routes.SCHEDULE_DETAIL -> R.string.nav_schedules
    Routes.SCHEDULE_NEW -> R.string.schedule_new
    Routes.SPACES, Routes.SPACE_DETAIL -> R.string.nav_spaces
    Routes.SETTINGS -> R.string.settings_title
    Routes.MEMORY -> R.string.memory_title
    DebugFeatures.ROUTE -> R.string.catalog_title
    else -> R.string.nav_chat
}

@Composable
private fun TopBar(
    title: String,
    showBack: Boolean,
    showSettings: Boolean,
    onBack: () -> Unit,
    onSettings: () -> Unit,
    onMenu: (() -> Unit)? = null
) {
    val colors = AiosTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.bg)
            .statusBarsPadding()
            .drawBehind {
                val y = size.height - Hairline.toPx() / 2
                drawLine(colors.border, Offset(0f, y), Offset(size.width, y), Hairline.toPx())
            }
            .padding(horizontal = Tokens.Space.s4),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (showBack) {
            IconButton(R.drawable.ic_arrow_left, stringResource(R.string.nav_back), onBack)
        } else if (onMenu != null) {
            IconButton(R.drawable.ic_menu, stringResource(R.string.chat_drawer_title), onMenu)
        } else {
            Box(modifier = Modifier.size(Tokens.Space.s12))
        }
        Text(
            text = title,
            style = AiosTheme.type.section,
            color = colors.text,
            modifier = Modifier.weight(1f)
        )
        if (showSettings) {
            IconButton(R.drawable.ic_settings, stringResource(R.string.nav_settings), onSettings)
        }
    }
}

@Composable
private fun IconButton(@DrawableRes icon: Int, description: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(Tokens.touchTarget)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        AiosIcon(icon, contentDescription = description)
    }
}

@Composable
private fun BottomBar(currentRoute: String, nav: NavHostController) {
    val colors = AiosTheme.colors
    NavigationBar(
        containerColor = colors.surface,
        tonalElevation = 0.dp,
        modifier = Modifier.drawBehind {
            drawLine(
                colors.border,
                Offset(0f, Hairline.toPx() / 2),
                Offset(size.width, Hairline.toPx() / 2),
                Hairline.toPx()
            )
        }
    ) {
        tabs.forEach { tab ->
            val selected = currentRoute == tab.route
            val iconTint = if (selected) colors.accent else colors.text2
            NavigationBarItem(
                selected = selected,
                onClick = {
                    nav.navigate(tab.route) {
                        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = { AiosIcon(tab.icon, contentDescription = null, tint = iconTint) },
                label = { Text(stringResource(tab.label), style = AiosTheme.type.caption) },
                colors = NavigationBarItemDefaults.colors(
                    selectedTextColor = colors.text,
                    unselectedTextColor = colors.text2,
                    indicatorColor = colors.accentSoft
                )
            )
        }
    }
}
