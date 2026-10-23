package app.aios.android.debug

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import app.aios.android.R
import app.aios.android.ui.components.AiosButton
import app.aios.android.ui.components.AiosChip
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.AiosListItem
import app.aios.android.ui.components.AiosSnackbarHost
import app.aios.android.ui.components.AiosTextField
import app.aios.android.ui.components.ButtonKind
import app.aios.android.ui.components.EmptyState
import app.aios.android.ui.components.ErrorBanner
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.components.OfflineBanner
import app.aios.android.ui.components.SkeletonList
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.PlexMono
import app.aios.ui.tokens.Tokens
import kotlinx.coroutines.launch

/*
 * Halaman katalog untuk review visual (hanya build debug). Teks di sini sengaja tidak masuk strings.xml
 * karena tidak pernah sampai ke pengguna. Pembanding tema terang/gelap memakai AiosTheme lokal,
 * jadi dua tema bisa diperiksa tanpa mengubah pengaturan aplikasi.
 */
@Composable
fun CatalogScreen() {
    var dark by remember { mutableStateOf(false) }
    AiosTheme(darkTheme = dark) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(AiosTheme.colors.bg)
                .verticalScroll(rememberScrollState())
                .padding(Tokens.Space.s16),
            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s24)
        ) {
            Block("Tema pratinjau") {
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                    AiosChip("Terang", selected = !dark, onClick = { dark = false })
                    AiosChip("Gelap", selected = dark, onClick = { dark = true })
                }
            }
            ColorsBlock()
            TypographyBlock()
            ButtonsBlock()
            FieldsBlock()
            ChipsAndListBlock()
            StatesBlock()
        }
    }
}

@Composable
private fun Block(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s12)) {
        Text(title, style = AiosTheme.type.section, color = AiosTheme.colors.text)
        content()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ColorsBlock() = Block("Warna") {
    val c = AiosTheme.colors
    val swatches = listOf(
        "bg" to c.bg, "surface" to c.surface, "surface2" to c.surface2, "border" to c.border,
        "borderStrong" to c.borderStrong, "text" to c.text, "text2" to c.text2, "text3" to c.text3,
        "accent" to c.accent, "accentSoft" to c.accentSoft, "success" to c.success,
        "warning" to c.warning, "danger" to c.danger, "info" to c.info
    )
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        swatches.forEach { (name, color) -> Swatch(name, color) }
    }
}

@Composable
private fun Swatch(name: String, color: Color) {
    Column(
        modifier = Modifier.size(
            width = Tokens.Space.s48 + Tokens.Space.s24,
            height = Tokens.Space.s48 + Tokens.Space.s16
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .height(Tokens.Space.s32)
                .background(color, RoundedCornerShape(Tokens.Radius.sm))
                .border(Hairline, AiosTheme.colors.border, RoundedCornerShape(Tokens.Radius.sm))
        ) {}
        Text(name, style = AiosTheme.type.caption, color = AiosTheme.colors.text2)
    }
}

@Composable
private fun TypographyBlock() = Block("Tipografi") {
    val t = AiosTheme.type
    val c = AiosTheme.colors.text
    Text("Judul halaman 22 sp", style = t.page, color = c)
    Text("Judul bagian 18 sp", style = t.section, color = c)
    Text(
        "Isi chat 16 sp. Teks panjang dibatasi sekitar 72 karakter per baris agar nyaman dibaca.",
        style = t.chat,
        color = c
    )
    Text("UI default 14 sp", style = t.ui, color = c)
    Text("Meta 13 sp", style = t.meta, color = c)
    Text("Caption 12 sp", style = t.caption, color = c)
    Text("mono: app/src/main.kt +12 -3", style = t.mono.copy(fontFamily = PlexMono), color = c)
}

@Composable
private fun ButtonsBlock() = Block("Tombol") {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        AiosButton("Primer", {}, kind = ButtonKind.Primary, modifier = Modifier.fillMaxWidth())
        AiosButton("Sekunder", {}, kind = ButtonKind.Secondary, modifier = Modifier.fillMaxWidth())
        AiosButton("Ghost", {}, kind = ButtonKind.Ghost, modifier = Modifier.fillMaxWidth())
        AiosButton("Hapus", {}, kind = ButtonKind.Danger, modifier = Modifier.fillMaxWidth())
        AiosButton("Nonaktif", {}, kind = ButtonKind.Primary, enabled = false, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun FieldsBlock() = Block("Field") {
    var a by remember { mutableStateOf("") }
    var b by remember { mutableStateOf("isi yang salah") }
    var c by remember { mutableStateOf("terkunci") }
    AiosTextField(
        value = a,
        onValueChange = { a = it },
        label = "Kosong dengan placeholder",
        placeholder = "ketik di sini",
        supportingText = "Teks bantu"
    )
    AiosTextField(
        value = b,
        onValueChange = { b = it },
        label = "Dengan error",
        errorText = "Pesan error menyebut apa yang salah dan langkah berikutnya."
    )
    AiosTextField(c, { c = it }, label = "Nonaktif", enabled = false)
}

@Composable
private fun ChipsAndListBlock() = Block("Chip dan item daftar") {
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
        AiosChip("general")
        AiosChip("researcher", selected = true)
        AiosChip("writer", onClick = {})
    }
    Column(modifier = Modifier.border(Hairline, AiosTheme.colors.border, RoundedCornerShape(Tokens.Radius.sm))) {
        AiosListItem(
            title = "Ringkasan berita AI",
            supporting = "Setiap Senin 07.00 WIB",
            trailing = "2 jam lalu",
            leadingIcon = R.drawable.ic_schedule,
            onClick = {}
        )
        AiosListItem(title = "Tanpa ikon dan tanpa aksi", supporting = "Baris statis")
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12)) {
        listOf(
            R.drawable.ic_chat,
            R.drawable.ic_research,
            R.drawable.ic_schedule,
            R.drawable.ic_settings,
            R.drawable.ic_copy,
            R.drawable.ic_alert,
            R.drawable.ic_wifi_off,
            R.drawable.ic_close
        ).forEach {
            AiosIcon(it, contentDescription = null)
        }
    }
}

@Composable
private fun StatesBlock() = Block("State") {
    val host = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    OfflineBanner()
    ErrorBanner(message = "Server tidak terjangkau. Periksa alamatnya dan pastikan server menyala.", onRetry = {
    }, onDismiss = {})
    EmptyState(
        message = "Belum ada jadwal. Tulis jadwal dalam kalimat biasa untuk memulai.",
        actionLabel = "Buat jadwal",
        onAction = {}
    )
    SkeletonList(rows = 2)
    AiosButton("Tampilkan snackbar", {
        scope.launch { host.showSnackbar("Disalin ke papan klip", actionLabel = "Urungkan") }
    })
    AiosSnackbarHost(host)
}
