package app.aios.android

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.api.Space
import app.aios.android.data.api.SpaceDocument
import app.aios.android.data.chat.AttachmentSource
import app.aios.android.data.chat.PickedFile
import app.aios.android.data.spaces.SpaceRepository
import app.aios.android.ui.spaces.SpaceDetailViewModel
import app.aios.android.ui.spaces.SpaceEvent
import app.aios.android.ui.spaces.SpaceListViewModel
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
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

private fun space(id: String, name: String = "Ruang $id", docs: Int = 0) = Space(id, name, "", docs, TS, TS)

private class FakeSpaceRepo : SpaceRepository {
    val spaces = mutableListOf<Space>()
    val docs = mutableMapOf<String, MutableList<SpaceDocument>>()
    var failAdd: Exception? = null
    val deleted = mutableListOf<String>()

    override suspend fun list() = spaces.toList()

    override suspend fun create(name: String, description: String) = space("baru", name.trim()).also { spaces += it }

    override suspend fun delete(id: String) {
        deleted += id
        spaces.removeAll { it.id == id }
    }

    override suspend fun documents(spaceId: String) = docs[spaceId].orEmpty().toList()

    override suspend fun addDocument(spaceId: String, fileId: String): SpaceDocument {
        failAdd?.let {
            failAdd = null
            throw it
        }
        return SpaceDocument("d-$fileId", spaceId, fileId, "dok-$fileId.txt", 100, 1, TS)
            .also { docs.getOrPut(spaceId) { mutableListOf() } += it }
    }

    override suspend fun deleteDocument(spaceId: String, documentId: String) {
        docs[spaceId]?.removeAll { it.id == documentId }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SpaceViewModelTest {
    private val dispatcher = StandardTestDispatcher(TestCoroutineScheduler())
    private val repo = FakeSpaceRepo()
    private val connectivity = FakeConnectivity()
    private val created = mutableListOf<ViewModel>()
    private val events = mutableListOf<SpaceEvent>()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() {
        created.forEach { it.viewModelScope.cancel() }
        Dispatchers.resetMain()
    }

    private fun TestScope.listVm() = SpaceListViewModel(repo, connectivity).also { vm ->
        created += vm
        backgroundScope.launch { vm.events.collect { events += it } }
    }

    private fun TestScope.detailVm(chat: FakeChatRepo = FakeChatRepo()) = SpaceDetailViewModel(
        SavedStateHandle(mapOf("id" to "s1")),
        repo,
        chat,
        AttachmentSource { uri -> PickedFile("$uri.txt", "text/plain", "isi".toByteArray()) },
        connectivity
    ).also { vm ->
        created += vm
        backgroundScope.launch { vm.events.collect { events += it } }
    }

    @Test
    fun `daftar memuat ruang dan membuat ruang baru lalu membukanya`() = runTest(dispatcher) {
        repo.spaces += space("s1", docs = 2)
        val vm = listVm()
        runCurrent()
        assertEquals(listOf("s1"), vm.ui.value.items.map { it.id })

        vm.onName("  Kontrak  ")
        vm.create()
        runCurrent()
        assertEquals("Kontrak", repo.spaces.last().name)
        assertEquals("", vm.ui.value.name)
        assertEquals(SpaceEvent.Created("baru"), events.last())
    }

    @Test
    fun `detail - unggah berkas lalu indeks, satu gagal tidak menghentikan sisanya`() = runTest(dispatcher) {
        repo.spaces += space("s1")
        val vm = detailVm()
        runCurrent()
        assertNotNull(vm.ui.value.space)

        repo.failAdd = IOException("putus")
        vm.addFiles(listOf("a", "b"))
        runCurrent()
        assertEquals(1, vm.ui.value.documents.size)
        assertNull(vm.ui.value.adding)
        assertTrue(events.any { it is SpaceEvent.Notice && it.arg != null })
        assertEquals(1, vm.ui.value.space?.documentCount)
    }

    @Test
    fun `detail - keluarkan dokumen dan hapus ruang`() = runTest(dispatcher) {
        repo.spaces += space("s1")
        repo.docs["s1"] = mutableListOf(SpaceDocument("d1", "s1", "f1", "a.txt", 10, 1, TS))
        val vm = detailVm()
        runCurrent()
        vm.removeDocument(vm.ui.value.documents.single())
        runCurrent()
        assertTrue(vm.ui.value.documents.isEmpty())

        vm.delete()
        runCurrent()
        assertEquals(listOf("s1"), repo.deleted)
        assertEquals(SpaceEvent.Deleted, events.last())
    }

    @Test
    fun `ruang yang sudah dihapus - detail tanpa ruang`() = runTest(dispatcher) {
        val vm = detailVm()
        runCurrent()
        assertNull(vm.ui.value.space)
        assertNull(vm.ui.value.error)
    }
}
