package app.aios.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import app.aios.android.R
import app.aios.ui.tokens.AiosTextStyle
import app.aios.ui.tokens.Tokens

/** IBM Plex dibundel di res/font (lisensi OFL ada di apps/android/licenses). */
val PlexSans = FontFamily(
    Font(R.font.ibm_plex_sans_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_sans_medium, FontWeight.Medium),
    Font(R.font.ibm_plex_sans_semibold, FontWeight.SemiBold)
)

val PlexMono = FontFamily(
    Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_mono_medium, FontWeight.Medium)
)

private fun AiosTextStyle.toTextStyle(family: FontFamily = PlexSans) = TextStyle(
    fontFamily = family,
    fontSize = fontSize,
    lineHeight = lineHeight,
    fontWeight = fontWeight
)

/** Skala tipografi dari Tokens.Type, ditambah gaya mono untuk kode, path, dan angka teknis. */
data class AiosTypography(
    val caption: TextStyle,
    val meta: TextStyle,
    val ui: TextStyle,
    val uiStrong: TextStyle,
    val chat: TextStyle,
    val section: TextStyle,
    val page: TextStyle,
    val mono: TextStyle
) {
    fun toMaterial() = Typography(
        displayLarge = page, displayMedium = page, displaySmall = page,
        headlineLarge = page, headlineMedium = page, headlineSmall = section,
        titleLarge = page, titleMedium = section, titleSmall = uiStrong,
        bodyLarge = chat, bodyMedium = ui, bodySmall = meta,
        labelLarge = uiStrong, labelMedium = meta, labelSmall = caption
    )

    companion object {
        val Default = AiosTypography(
            caption = Tokens.Type.caption.toTextStyle(),
            meta = Tokens.Type.meta.toTextStyle(),
            ui = Tokens.Type.ui.toTextStyle(),
            uiStrong = Tokens.Type.ui.toTextStyle().copy(fontWeight = FontWeight.Medium),
            chat = Tokens.Type.chat.toTextStyle(),
            section = Tokens.Type.section.toTextStyle(),
            page = Tokens.Type.page.toTextStyle(),
            mono = Tokens.Type.meta.toTextStyle(PlexMono)
        )
    }
}
