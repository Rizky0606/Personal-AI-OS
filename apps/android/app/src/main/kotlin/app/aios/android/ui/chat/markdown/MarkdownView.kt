package app.aios.android.ui.chat.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.size
import app.aios.android.R
import app.aios.android.ui.components.AiosIcon
import app.aios.android.ui.components.Hairline
import app.aios.android.ui.theme.AiosTheme
import app.aios.android.ui.theme.PlexMono
import app.aios.ui.tokens.Tokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Lebar baca maksimal ±72 karakter (DESIGN_SYSTEM.md); di tablet menjaga baris tetap enak dibaca. */
private val ReadingWidth = Tokens.Space.s48 * 13

/**
 * Menampilkan Markdown. Penguraian dijalankan di luar thread utama dan hasil sebelumnya tetap tampil
 * selama jawaban yang mengalir diurai ulang, sehingga streaming tidak menahan frame.
 */
@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    citations: Map<Int, String> = emptyMap(),
    onCopied: () -> Unit = {}
) {
    var blocks by remember { mutableStateOf(Markdown.parse(text.take(SYNC_PARSE_LIMIT))) }
    LaunchedEffect(text) {
        blocks = if (text.length <= SYNC_PARSE_LIMIT) {
            Markdown.parse(text)
        } else {
            withContext(Dispatchers.Default) { Markdown.parse(text) }
        }
    }
    CompositionLocalProvider(LocalCitations provides citations) {
        SelectionContainer {
            Column(
                modifier = modifier.widthIn(max = ReadingWidth),
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.s12)
            ) {
                blocks.forEach { RenderBlock(it, onCopied) }
            }
        }
    }
}

private const val SYNC_PARSE_LIMIT = 2_000

/** Nomor rujukan `[n]` ke URL sumber; bila ada, `[n]` di teks menjadi tautan yang bisa diketuk. */
private val LocalCitations = staticCompositionLocalOf<Map<Int, String>> { emptyMap() }

private val citationRe = Regex("""\[(\d{1,3})]""")

@Composable
private fun RenderBlock(block: Block, onCopied: () -> Unit) {
    val colors = AiosTheme.colors
    val type = AiosTheme.type
    when (block) {
        is Block.Heading -> Text(
            text = rememberInline(block.inlines),
            style = if (block.level <= 2) type.section else type.chat.copy(fontWeight = FontWeight.SemiBold),
            color = colors.text
        )
        is Block.Paragraph -> Text(text = rememberInline(block.inlines), style = type.chat, color = colors.text)
        is Block.Code -> CodeBlock(block, onCopied)
        is Block.Quote -> Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .width(Tokens.Space.s4)
                    .fillMaxHeight()
                    .background(colors.borderStrong, RoundedCornerShape(Tokens.Radius.sm))
            )
            Column(
                modifier = Modifier.padding(start = Tokens.Space.s12),
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
            ) { block.blocks.forEach { RenderBlock(it, onCopied) } }
        }
        is Block.ListBlock -> ListView(block, onCopied)
        is Block.Table -> TableView(block)
        Block.Rule -> Box(Modifier.fillMaxWidth().height(Hairline).background(colors.border))
    }
}

@Composable
private fun ListView(list: Block.ListBlock, onCopied: () -> Unit) {
    val colors = AiosTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
        list.items.forEachIndexed { index, item ->
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s8)) {
                Text(
                    text = if (list.ordered) "${list.start + index}." else "•",
                    style = AiosTheme.type.chat,
                    color = colors.text2,
                    modifier = Modifier.widthIn(min = Tokens.Space.s16)
                )
                Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
                    Text(text = rememberInline(item.inlines), style = AiosTheme.type.chat, color = colors.text)
                    item.children.forEach { RenderBlock(it, onCopied) }
                }
            }
        }
    }
}

@Composable
private fun CodeBlock(block: Block.Code, onCopied: () -> Unit) {
    val colors = AiosTheme.colors
    val clipboard = LocalClipboardManager.current
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(Hairline, colors.border, shape)
            .background(colors.surface, shape)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.surface2, RoundedCornerShape(topStart = Tokens.Radius.sm, topEnd = Tokens.Radius.sm))
                .padding(start = Tokens.Space.s12),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = block.language.ifBlank { "teks" },
                style = AiosTheme.type.caption.copy(fontFamily = PlexMono),
                color = colors.text2,
                modifier = Modifier.weight(1f)
            )
            val label = stringResource(R.string.chat_copy_code)
            Box(
                modifier = Modifier
                    .size(Tokens.touchTarget)
                    .clickable(role = Role.Button) {
                        clipboard.setText(AnnotatedString(block.code))
                        onCopied()
                    },
                contentAlignment = Alignment.Center
            ) { AiosIcon(R.drawable.ic_copy, contentDescription = label) }
        }
        Text(
            text = block.code,
            style = AiosTheme.type.mono,
            color = colors.text,
            softWrap = false,
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(Tokens.Space.s12)
        )
    }
}

@Composable
private fun TableView(table: Block.Table) {
    val colors = AiosTheme.colors
    val cellWidth = Tokens.Space.s48 * 2
    Column(
        modifier = Modifier
            .horizontalScroll(rememberScrollState())
            .border(Hairline, colors.border, RoundedCornerShape(Tokens.Radius.sm))
    ) {
        TableRow(table.header, cellWidth, header = true)
        table.rows.forEach { TableRow(it, cellWidth, header = false) }
    }
}

@Composable
private fun TableRow(cells: List<List<Inline>>, cellWidth: androidx.compose.ui.unit.Dp, header: Boolean) {
    val colors = AiosTheme.colors
    Row(modifier = Modifier.background(if (header) colors.surface2 else colors.surface)) {
        cells.forEach { cell ->
            Text(
                text = rememberInline(cell),
                style = if (header) AiosTheme.type.uiStrong else AiosTheme.type.ui,
                color = colors.text,
                modifier = Modifier
                    .width(cellWidth)
                    .padding(Tokens.Space.s8)
            )
        }
    }
}

@Composable
private fun rememberInline(inlines: List<Inline>): AnnotatedString {
    val colors = AiosTheme.colors
    val citations = LocalCitations.current
    return remember(inlines, colors, citations) { buildInline(inlines, colors.surface2, colors.info, citations) }
}

private fun buildInline(
    inlines: List<Inline>,
    codeBackground: androidx.compose.ui.graphics.Color,
    linkColor: androidx.compose.ui.graphics.Color,
    citations: Map<Int, String>
): AnnotatedString = buildAnnotatedString {
    fun walk(nodes: List<Inline>) {
        for (node in nodes) {
            when (node) {
                is Inline.Text -> appendWithCitations(node.text, citations, linkColor)
                is Inline.Code -> withStyle(
                    SpanStyle(fontFamily = PlexMono, background = codeBackground)
                ) { append(node.code) }
                is Inline.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { walk(node.children) }
                is Inline.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { walk(node.children) }
                is Inline.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                    walk(node.children)
                }
                is Inline.Link -> withLink(
                    LinkAnnotation.Url(
                        node.url,
                        TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
                    )
                ) { walk(node.children) }
            }
        }
    }
    walk(inlines)
}

/** Teks biasa; `[n]` yang punya sumber menjadi tautan ke sumber itu (hanya http/https). */
private fun AnnotatedString.Builder.appendWithCitations(
    text: String,
    citations: Map<Int, String>,
    linkColor: androidx.compose.ui.graphics.Color
) {
    if (citations.isEmpty()) {
        append(text)
        return
    }
    var last = 0
    for (m in citationRe.findAll(text)) {
        val url = citations[m.groupValues[1].toInt()] ?: continue
        append(text.substring(last, m.range.first))
        withLink(
            LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = linkColor, fontWeight = FontWeight.Medium)))
        ) { append(m.value) }
        last = m.range.last + 1
    }
    append(text.substring(last))
}
