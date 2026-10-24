package app.aios.android

import app.aios.android.data.api.LoginRequest
import app.aios.android.data.api.LoginResponse
import app.aios.android.data.api.PublicAuthApi
import app.aios.android.data.api.RefreshRequest
import app.aios.android.data.api.ServerEndpoint
import app.aios.android.data.api.SessionApi
import app.aios.android.data.api.TokenPair
import app.aios.android.data.auth.AuthRepository
import app.aios.android.data.auth.SessionEvents
import app.aios.android.ui.login.LoginViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import retrofit2.Response

@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {
    private val loginCalls = mutableListOf<LoginRequest>()

    private val publicApi = object : PublicAuthApi {
        override suspend fun login(body: LoginRequest): LoginResponse {
            loginCalls += body
            error("tidak dipakai: validasi lokal harus menolak sebelum request")
        }

        override suspend fun refresh(body: RefreshRequest): TokenPair = error("tidak dipakai")
    }
    private val sessionApi = object : SessionApi {
        override suspend fun logout(): Response<Unit> = error("tidak dipakai")
    }

    @Before
    fun setUp() = Dispatchers.setMain(StandardTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel(lastUrl: String? = null, fixedUrl: String? = null): LoginViewModel {
        val events = SessionEvents()
        val repo = AuthRepository(
            store = FakeTokenStore(null, lastUrl),
            publicApi = publicApi,
            sessionApi = sessionApi,
            endpoint = ServerEndpoint(load = { null }),
            events = events,
            deviceName = "Pixel 8",
            allowCleartextLocal = false,
            isConnected = { true },
            fixedServerUrl = fixedUrl
        )
        return LoginViewModel(repo, events)
    }

    @Test
    fun `alamat server terakhir terisi otomatis`() = runTest {
        val vm = viewModel(lastUrl = "https://aios.contoh.com")
        advanceUntilIdle()
        assertEquals("https://aios.contoh.com", vm.ui.value.serverUrl)
    }

    @Test
    fun `alamat tertanam menang atas alamat terakhir dan isian alamat disembunyikan`() = runTest {
        val vm = viewModel(lastUrl = "https://lama.contoh.com", fixedUrl = "https://ai.contoh.com")
        advanceUntilIdle()
        assertEquals("https://ai.contoh.com", vm.ui.value.serverUrl)
        assertEquals(true, vm.ui.value.fixedServer)
    }

    @Test
    fun `TOTP hanya menerima digit dan dipotong 6`() = runTest {
        val vm = viewModel()
        vm.onTotp("12 34-56789")
        assertEquals("123456", vm.ui.value.totp)
    }

    @Test
    fun `password kosong dan TOTP pendek ditolak lokal tanpa request`() = runTest {
        val vm = viewModel()
        vm.onServerUrl("aios.contoh.com")
        vm.onTotp("123")

        vm.submit()
        advanceUntilIdle()

        assertEquals(R.string.login_error_password_empty, vm.ui.value.passwordError)
        assertEquals(R.string.login_error_totp_format, vm.ui.value.totpError)
        assertFalse(vm.ui.value.submitting)
        assertEquals(0, loginCalls.size)
    }

    @Test
    fun `mengetik menghapus error field yang bersangkutan`() = runTest {
        val vm = viewModel()
        vm.submit()
        advanceUntilIdle()

        vm.onPassword("x")
        vm.onTotp("1")

        assertNull(vm.ui.value.passwordError)
        assertNull(vm.ui.value.totpError)
    }

    @Test
    fun `alamat kosong memberi pesan khusus alamat`() = runTest {
        val vm = viewModel()
        vm.onPassword("rahasia-panjang")
        vm.onTotp("123456")

        vm.submit()
        advanceUntilIdle()

        assertEquals(R.string.login_error_server_empty, vm.ui.value.serverError)
        assertEquals(0, loginCalls.size)
    }
}
