package app.aios.android

import androidx.lifecycle.viewModelScope
import app.aios.android.data.api.SearchHit
import app.aios.android.ui.chat.ConversationsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationsSearchTest {
    private val dispatcher = StandardTestDispatcher(TestCoroutineScheduler())

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun `query minimal 2 karakter mencari isi riwayat di server setelah jeda`() = runTest(dispatcher) {
        val repo = FakeChatRepo()
        repo.searchResults = listOf(
            SearchHit(
                kind = "message",
                title = "Backup VPS",
                snippet = "backup database",
                createdAt = TS,
                conversationId = "c9"
            )
        )
        val vm = ConversationsViewModel(repo, FakeConnectivity())
        try {
            vm.onQuery("b")
            advanceTimeBy(1_000)
            runCurrent()
            assertTrue(vm.ui.value.history.isEmpty())
            assertTrue(repo.searches.isEmpty())

            vm.onQuery("backup")
            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(listOf("backup"), repo.searches)
            assertEquals("c9", vm.ui.value.history.single().conversationId)

            vm.onQuery("")
            advanceTimeBy(1_000)
            runCurrent()
            assertTrue(vm.ui.value.history.isEmpty())
        } finally {
            vm.viewModelScope.cancel()
        }
    }
}
