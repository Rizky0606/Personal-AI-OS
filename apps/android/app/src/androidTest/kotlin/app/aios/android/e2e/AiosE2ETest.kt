package app.aios.android.e2e

import android.Manifest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToLog
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import app.aios.android.MainActivity
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runners.MethodSorters

/**
 * E2E Android (Fase 24): aplikasi asli di emulator melawan gateway nyata (Postgres tertanam; Hermes, 9Router, dan
 * SearXNG palsu) yang dinyalakan oleh e2e/harness/android-run.ts. Alamat, password, dan kode TOTP dikirim lewat argumen
 * instrumentasi. Tes berurutan berbagi sesi: login dulu, lalu chat, lalu riset.
 */
@OptIn(ExperimentalTestApi::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class AiosE2ETest {
    @get:Rule(order = 0)
    val permissions: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.RECORD_AUDIO)

    @get:Rule(order = 1)
    val compose = createAndroidComposeRule<MainActivity>()

    private val args = InstrumentationRegistry.getArguments()
    private fun arg(name: String): String = requireNotNull(args.getString(name)) { "argumen instrumentasi $name wajib" }

    /** Menunggu node muncul; bila gagal, pohon semantik dicetak ke logcat (tag E2E) supaya penyebabnya terlihat. */
    private fun await(matcher: androidx.compose.ui.test.SemanticsMatcher, timeoutMs: Long) {
        try {
            compose.waitUntilAtLeastOneExists(matcher, timeoutMs)
        } catch (e: androidx.compose.ui.test.ComposeTimeoutException) {
            compose.onRoot().printToLog("E2E")
            throw e
        }
    }

    private fun field(label: String) = compose.onNode(hasSetTextAction() and hasContentDescription(label))

    @Test
    fun a_login_masuk_dengan_totp_lalu_langsung_ke_chat() {
        await(hasText("Masuk ke server"), 30_000)
        field("Alamat server").performTextInput(arg("gatewayUrl"))
        field("Password").performTextInput(arg("password"))
        field("Kode TOTP").performTextInput(arg("totp"))
        compose.onNode(hasText("Masuk") and androidx.compose.ui.test.hasClickAction()).performClick()

        // Masuk: navigasi bawah (Chat, Riset, Jadwal) tampil.
        await(hasText("Riset"), 30_000)
        await(hasText("Jadwal"), 30_000)
    }

    @Test
    fun b_chat_jawaban_mengalir_dan_tampil_lengkap() {
        // Sesi dari tes sebelumnya tersimpan terenkripsi; aplikasi langsung masuk.
        await(hasContentDescription("Pesan"), 30_000)
        compose.onNode(hasSetTextAction() and hasContentDescription("Pesan"))
            .performTextInput("Halo dari Android, jelaskan closure.")
        compose.onNodeWithContentDescription("Kirim").performClick()

        await(hasText("Halo dari Android, jelaskan closure."), 15_000)
        await(hasText(arg("hermesAnswer"), substring = true), 45_000)
    }

    @Test
    fun c_riset_pertanyaan_sampai_laporan_bersitasi() {
        await(hasText("Riset"), 30_000)
        compose.onAllNodes(hasText("Riset"))[0].performClick()
        await(hasText("Riset baru"), 30_000)
        compose.onNodeWithText("Riset baru").performClick()

        field("Pertanyaan").performTextInput("Bagaimana perkembangan kendaraan listrik?")
        compose.onNodeWithText("Cepat").performClick()
        compose.onNodeWithText("Mulai riset").performClick()

        await(hasText("Laporan riset kendaraan listrik", substring = true), 90_000)
    }
}
