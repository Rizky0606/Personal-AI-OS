package app.aios.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.api.Memory
import app.aios.android.data.memory.MemoryRepository
import app.aios.android.ui.memory.MemoryEvent
import app.aios.android.ui.memory.MemoryViewModel
import app.aios.android.ui.memory.RememberViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

private fun memory(id: String, text: String = "fakta $id", enabled: Boolean = true) = Memory(id, text, enabled, TS, TS)

private class FakeMemoryRepo : MemoryRepository {
    val items = mutableListOf<Memory>()
    var failNext: Exception? = null
    val created = mutableListOf<String>()
    private var next = 0

    private fun maybeFail() {
        failNext?.let {
            failNext = null
            throw it
        }
    }

    override suspend fun list(): List<Memory> {
        maybeFail()
        return items.toList()
    }

    override suspend fun create(text: String): Memory {
        maybeFail()
        created += text
        return memory("n${next++}", text.trim()).also { items += it }
    }

    override suspend fun update(id: String, text: String?, enabled: Boolean?): Memory {
        maybeFail()
        val index = items.indexOfFirst { it.id == id }
        val updated = items[index].let { it.copy(text = text ?: it.text, enabled = enabled ?: it.enabled) }
        items[index] = updated
        return updated
    }

    override suspend fun delete(id: String) {
        maybeFail()
        items.removeAll { it.id == id }
    }
}

private fun conflict() = HttpException(
    Response.error<Unit>(
        409,
        """{"type":"t","title":"t","status":409,"detail":"penuh","code":"memory_limit"}"""
            .toResponseBody("application/problem+json".toMediaType())
    )
)

@OptIn(ExperimentalCoroutinesApi::class)
class MemoryViewModelTest {
    private val dispatcher = StandardTestDispatcher(TestCoroutineScheduler())
    private val repo = FakeMemoryRepo()
    private val connectivity = FakeConnectivity()
    private val created = mutableListOf<ViewModel>()
    private val events = mutableListOf<MemoryEvent>()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() {
        created.forEach { it.viewModelScope.cancel() }
        Dispatchers.resetMain()
    }

    private fun TestScope.vm() = MemoryViewModel(repo, connectivity).also { vm ->
        created += vm
        backgroundScope.launch { vm.events.collect { events += it } }
    }

    @Test
    fun `memuat daftar, kosong, dan gagal memuat saat offline`() = runTest(dispatcher) {
        repo.items += listOf(memory("a"), memory("b", enabled = false))
        val loaded = vm()
        runCurrent()
        assertEquals(listOf("a", "b"), loaded.ui.value.items.map { it.id })
        assertFalse(loaded.ui.value.loading)

        repo.items.clear()
        repo.failNext = IOException("putus")
        connectivity.state.value = false
        val failed = vm()
        runCurrent()
        assertNotNull(failed.ui.value.error)
        assertTrue(failed.ui.value.items.isEmpty())
    }

    @Test
    fun `tambah merapikan teks, mengosongkan isian, dan gagal mempertahankan isian`() = runTest(dispatcher) {
        val vm = vm()
        runCurrent()
        vm.onDraft("  Saya suka jawaban singkat.  ")
        vm.add()
        runCurrent()
        assertEquals(listOf("Saya suka jawaban singkat."), repo.created)
        assertEquals("", vm.ui.value.draft)
        assertEquals(1, vm.ui.value.items.size)

        vm.onDraft("satu lagi")
        repo.failNext = conflict()
        vm.add()
        runCurrent()
        assertEquals("satu lagi", vm.ui.value.draft)
        assertFalse(vm.ui.value.adding)
        assertTrue(events.any { it is MemoryEvent.Notice })
    }

    @Test
    fun `sakelar langsung berubah dan dikembalikan bila server menolak`() = runTest(dispatcher) {
        repo.items += memory("a")
        val vm = vm()
        runCurrent()
        vm.setEnabled(vm.ui.value.items.single(), false)
        runCurrent()
        assertFalse(vm.ui.value.items.single().enabled)

        repo.failNext = IOException("putus")
        vm.setEnabled(vm.ui.value.items.single(), true)
        runCurrent()
        assertFalse(vm.ui.value.items.single().enabled)
    }

    @Test
    fun `ubah lewat dialog dan hapus setelah konfirmasi`() = runTest(dispatcher) {
        repo.items += memory("a", "lama")
        val vm = vm()
        runCurrent()
        vm.startEdit(vm.ui.value.items.single())
        vm.onEditText("baru")
        vm.saveEdit()
        runCurrent()
        assertEquals("baru", vm.ui.value.items.single().text)
        assertNull(vm.ui.value.editing)

        vm.askDelete(vm.ui.value.items.single())
        assertNotNull(vm.ui.value.deleting)
        vm.confirmDelete()
        runCurrent()
        assertTrue(vm.ui.value.items.isEmpty())
        assertTrue(repo.items.isEmpty())
    }

    @Test
    fun `Ingat ini - teks pesan dipotong ke batas lalu disimpan`() = runTest(dispatcher) {
        val remember = RememberViewModel(repo, connectivity).also { created += it }
        val outcomes = mutableListOf<MemoryEvent>()
        backgroundScope.launch { remember.events.collect { outcomes += it } }
        remember.start("  " + "x".repeat(600))
        assertEquals(500, remember.ui.value.text.length)
        remember.onText("Saya memakai Windows 11.")
        remember.save()
        runCurrent()
        assertEquals(listOf("Saya memakai Windows 11."), repo.created)
        assertTrue(outcomes.contains(MemoryEvent.Saved))
    }
}
