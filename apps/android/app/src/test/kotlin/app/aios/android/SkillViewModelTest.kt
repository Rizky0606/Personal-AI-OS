package app.aios.android

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.data.api.SkillList
import app.aios.android.data.api.SkillSummary
import app.aios.android.data.skills.SkillRepository
import app.aios.android.ui.skills.SkillEvent
import app.aios.android.ui.skills.SkillViewModel
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
import kotlinx.serialization.json.Json
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

/*
 * Fixture di bawah ini adalah respons ASLI gateway (ditangkap dari gateway uji dengan Postgres sungguhan),
 * bukan JSON ketikan sendiri: ini yang menjaga DTO Android tetap sejalan dengan kontrak.
 */
private const val REAL_LIST = """{"items":[
{"id":"a11y-check","name":"a11y-check","description":"Saat meninjau atau membangun UI: periksa label, fokus, urutan tab, kontras AA, target sentuh, dan status bukan hanya warna.","version":"1","source":"builtin","checksum":"e39b68c37d2ac7e7edded0f86cc5fda876990382cfe47485836eedbcbb0a241b","trust":"official","status":"active","engines":["hermes","omp","dsh"],"pinned":false,"editable":false,"origin":null},
{"id":"catatan-rapat","name":"Catatan rapat","description":"Saat merangkum rapat tim.","version":"1","source":"user","checksum":"4d0ec69469792ae6386dd399398f02717e5ea63bdfafca96d630e331361648ba","trust":"community","status":"active","engines":["hermes","omp","dsh"],"pinned":true,"editable":true,"origin":null,"createdAt":"2026-11-12T01:22:03.436Z","updatedAt":"2026-11-12T01:22:03.436Z"}
]}"""

private const val REAL_SAVE_RESULT = """
{"id":"catatan-rapat","name":"Catatan rapat","description":"Saat merangkum rapat tim.","version":"1","source":"user","checksum":"4d0ec69469792ae6386dd399398f02717e5ea63bdfafca96d630e331361648ba","trust":"community","status":"disabled","engines":["hermes","omp","dsh"],"pinned":true,"editable":true,"origin":null,"createdAt":"2026-11-12T01:22:03.436Z","updatedAt":"2026-11-12T01:22:03.539Z","body":"1. Tulis keputusan.","scan":{"verdict":"safe","findings":[]},"hermesSync":"off"}
"""

private const val REAL_CORE_409 = """
{"type":"urn:aios:problem:skill_core","title":"Konflik dengan status saat ini","status":409,"detail":"\"scope-guard\" adalah skill inti yang selalu dipasang; tidak bisa dinonaktifkan.","code":"skill_core","instance":"urn:aios:request:78b64e21-f4b2-4640-9916-559eaea6b646"}
"""

private val json = Json { ignoreUnknownKeys = true }

private fun skill(id: String, status: String? = "active") = SkillSummary(
    id = id,
    name = "skill $id",
    description = "Saat $id.",
    version = "1",
    source = "user",
    checksum = "c".repeat(64),
    status = status
)

private class FakeSkillRepo : SkillRepository {
    val items = mutableListOf<SkillSummary>()
    var failNext: Exception? = null
    val calls = mutableListOf<Pair<String, Boolean>>()

    override suspend fun list(): List<SkillSummary> {
        failNext?.let {
            failNext = null
            throw it
        }
        return items.toList()
    }

    override suspend fun setActive(id: String, active: Boolean): SkillSummary {
        calls += id to active
        failNext?.let {
            failNext = null
            throw it
        }
        val index = items.indexOfFirst { it.id == id }
        val updated = items[index].copy(status = if (active) "active" else "disabled")
        items[index] = updated
        return updated
    }
}

private fun problem(code: Int, body: String) = HttpException(
    Response.error<Unit>(code, body.toResponseBody("application/problem+json".toMediaType()))
)

class SkillApiModelsTest {
    @Test
    fun `respons asli GET skills terbaca, termasuk origin null dan kolom opsional yang absen`() {
        val list = json.decodeFromString(SkillList.serializer(), REAL_LIST)
        assertEquals(listOf("a11y-check", "catatan-rapat"), list.items.map { it.id })
        val builtin = list.items[0]
        assertEquals("builtin", builtin.source)
        assertEquals(false, builtin.editable)
        assertNull(builtin.origin)
        assertNull(builtin.createdAt)
        assertTrue(builtin.isActive)
        assertEquals(true, list.items[1].pinned)
    }

    @Test
    fun `hasil simpan asli terbaca sebagai ringkasan walau membawa isi, pemindai, dan sinkron`() {
        val saved = json.decodeFromString(SkillSummary.serializer(), REAL_SAVE_RESULT)
        assertEquals("catatan-rapat", saved.id)
        assertEquals("disabled", saved.status)
        assertFalse(saved.isActive)
    }

    @Test
    fun `status absen dianggap aktif, diarsipkan dan nonaktif tidak aktif`() {
        assertTrue(skill("a", status = null).isActive)
        assertFalse(skill("a", status = "disabled").isActive)
        assertFalse(skill("a", status = "archived").isActive)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SkillViewModelTest {
    private val dispatcher = StandardTestDispatcher(TestCoroutineScheduler())
    private val repo = FakeSkillRepo()
    private val connectivity = FakeConnectivity()
    private val created = mutableListOf<ViewModel>()
    private val events = mutableListOf<SkillEvent>()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() {
        created.forEach { it.viewModelScope.cancel() }
        Dispatchers.resetMain()
    }

    private fun TestScope.vm() = SkillViewModel(repo, connectivity).also { vm ->
        created += vm
        backgroundScope.launch { vm.events.collect { events += it } }
    }

    @Test
    fun `memuat daftar, dan gagal memuat saat offline menampilkan galat`() = runTest(dispatcher) {
        repo.items += listOf(skill("a"), skill("b", status = "disabled"))
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
    fun `sakelar berubah dan dipertahankan bila server menerima`() = runTest(dispatcher) {
        repo.items += skill("a")
        val vm = vm()
        runCurrent()
        vm.setActive(vm.ui.value.items.single(), false)
        runCurrent()
        assertFalse(vm.ui.value.items.single().isActive)
        assertEquals(listOf("a" to false), repo.calls)
    }

    @Test
    fun `sakelar dikembalikan dan snackbar muncul bila jaringan gagal`() = runTest(dispatcher) {
        repo.items += skill("a")
        val vm = vm()
        runCurrent()
        repo.failNext = IOException("putus")
        vm.setActive(vm.ui.value.items.single(), false)
        runCurrent()
        assertTrue(vm.ui.value.items.single().isActive)
        assertTrue(events.any { it is SkillEvent.Notice })
    }

    @Test
    fun `skill inti - 409 asli dari gateway mengembalikan sakelar dengan pesan khusus`() = runTest(dispatcher) {
        repo.items += skill("scope-guard")
        val vm = vm()
        runCurrent()
        repo.failNext = problem(409, REAL_CORE_409)
        vm.setActive(vm.ui.value.items.single(), false)
        runCurrent()
        assertTrue(vm.ui.value.items.single().isActive)
        val notice = events.filterIsInstance<SkillEvent.Notice>().single()
        assertEquals(R.string.skills_core_locked, notice.message)
    }

    @Test
    fun `mengatur ke keadaan yang sama tidak memanggil server`() = runTest(dispatcher) {
        repo.items += skill("a")
        val vm = vm()
        runCurrent()
        vm.setActive(vm.ui.value.items.single(), true)
        runCurrent()
        assertTrue(repo.calls.isEmpty())
    }

    @Test
    fun `skill diarsipkan bisa diaktifkan lagi`() = runTest(dispatcher) {
        repo.items += skill("a", status = "archived")
        val vm = vm()
        runCurrent()
        assertFalse(vm.ui.value.items.single().isActive)
        vm.setActive(vm.ui.value.items.single(), true)
        runCurrent()
        assertTrue(vm.ui.value.items.single().isActive)
    }
}
