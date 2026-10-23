package app.aios.android.ui.chat.markdown

sealed interface Inline {
    data class Text(val text: String) : Inline

    data class Code(val code: String) : Inline

    data class Bold(val children: List<Inline>) : Inline

    data class Italic(val children: List<Inline>) : Inline

    data class Strike(val children: List<Inline>) : Inline

    data class Link(val children: List<Inline>, val url: String) : Inline
}

sealed interface Block {
    data class Heading(val level: Int, val inlines: List<Inline>) : Block

    data class Paragraph(val inlines: List<Inline>) : Block

    /** [closed] false = pagar penutup belum datang (jawaban masih mengalir). */
    data class Code(val language: String, val code: String, val closed: Boolean) : Block

    data class Quote(val blocks: List<Block>) : Block

    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<ListItem>) : Block

    data class Table(val header: List<List<Inline>>, val rows: List<List<List<Inline>>>) : Block

    data object Rule : Block
}

data class ListItem(val inlines: List<Inline>, val children: List<Block>)

/**
 * Markdown ringan untuk jawaban chat: judul, paragraf, daftar bersarang, kutipan, blok kode berpagar,
 * tabel, garis, dan inline (tebal, miring, coret, kode, tautan http/https/mailto). Murni Kotlin tanpa
 * dependensi. Masukan yang belum selesai (streaming) tetap menghasilkan keluaran yang wajar.
 */
object Markdown {
    private val headingRe = Regex("""^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$""")
    private val ruleRe = Regex("""^ {0,3}([-*_])(\s*\1){2,}\s*$""")
    private val fenceRe = Regex("""^ {0,3}(`{3,}|~{3,})\s*([^\s`]*).*$""")
    private val listRe = Regex("""^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$""")
    private val quoteRe = Regex("""^ {0,3}>\s?(.*)$""")
    private val tableSepRe = Regex("""^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$""")

    fun parse(source: String): List<Block> = parseBlocks(source.replace("\r\n", "\n").split('\n'))

    private fun parseBlocks(lines: List<String>): List<Block> {
        val blocks = ArrayList<Block>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            when {
                line.isBlank() -> i++
                fenceRe.matches(line) -> i = fenced(lines, i, blocks)
                headingRe.matches(line) -> {
                    val m = headingRe.matchEntire(line)!!
                    blocks += Block.Heading(m.groupValues[1].length, Inlines.parse(m.groupValues[2]))
                    i++
                }
                ruleRe.matches(line) -> {
                    blocks += Block.Rule
                    i++
                }
                quoteRe.matches(line) -> i = quote(lines, i, blocks)
                isTableStart(lines, i) -> i = table(lines, i, blocks)
                listRe.matches(line) -> i = list(lines, i, blocks)
                else -> i = paragraph(lines, i, blocks)
            }
        }
        return blocks
    }

    private fun fenced(lines: List<String>, from: Int, out: MutableList<Block>): Int {
        val open = fenceRe.matchEntire(lines[from])!!
        val fence = open.groupValues[1]
        val language = open.groupValues[2]
        val body = ArrayList<String>()
        var i = from + 1
        var closed = false
        while (i < lines.size) {
            val t = lines[i].trim()
            if (t.length >= fence.length && t.all { it == fence[0] }) {
                closed = true
                i++
                break
            }
            body += lines[i]
            i++
        }
        out += Block.Code(language, body.joinToString("\n"), closed)
        return i
    }

    private fun quote(lines: List<String>, from: Int, out: MutableList<Block>): Int {
        val inner = ArrayList<String>()
        var i = from
        while (i < lines.size) {
            val m = quoteRe.matchEntire(lines[i]) ?: break
            inner += m.groupValues[1]
            i++
        }
        out += Block.Quote(parseBlocks(inner))
        return i
    }

    private fun isTableStart(lines: List<String>, i: Int): Boolean =
        i + 1 < lines.size && lines[i].contains('|') && isTableSeparator(lines[i + 1])

    private fun isTableSeparator(line: String): Boolean =
        tableSepRe.matches(line) && line.contains('-') && line.contains('|')

    private fun cells(line: String): List<String> {
        var t = line.trim()
        if (t.startsWith("|")) t = t.drop(1)
        if (t.endsWith("|") && !t.endsWith("\\|")) t = t.dropLast(1)
        return t.split(Regex("""(?<!\\)\|""")).map { it.trim().replace("\\|", "|") }
    }

    private fun table(lines: List<String>, from: Int, out: MutableList<Block>): Int {
        val header = cells(lines[from]).map(Inlines::parse)
        val rows = ArrayList<List<List<Inline>>>()
        var i = from + 2
        while (i < lines.size && lines[i].isNotBlank() && lines[i].contains('|')) {
            rows += cells(lines[i]).map(Inlines::parse)
            i++
        }
        out += Block.Table(header, rows)
        return i
    }

    private data class RawItem(val indent: Int, val ordered: Boolean, val number: Int, val text: StringBuilder)

    private fun list(lines: List<String>, from: Int, out: MutableList<Block>): Int {
        val raw = ArrayList<RawItem>()
        var i = from
        while (i < lines.size) {
            val line = lines[i]
            val m = listRe.matchEntire(line)
            if (m != null && !ruleRe.matches(line)) {
                val marker = m.groupValues[2]
                raw += RawItem(
                    indent = m.groupValues[1].replace("\t", "    ").length,
                    ordered = marker.first().isDigit(),
                    number = marker.takeWhile { it.isDigit() }.toIntOrNull() ?: 1,
                    text = StringBuilder(m.groupValues[3])
                )
                i++
            } else if (line.isNotBlank() && raw.isNotEmpty() && line.startsWith(" ") && !isBlockStart(line.trim())) {
                // Lanjutan baris item sebelumnya.
                raw.last().text.append('\n').append(line.trim())
                i++
            } else if (line.isBlank() && i + 1 < lines.size && listRe.matches(lines[i + 1])) {
                i++
            } else {
                break
            }
        }
        out += buildList(raw, 0, raw.size).first()
        return i
    }

    private fun isBlockStart(trimmed: String) =
        fenceRe.matches(trimmed) || headingRe.matches(trimmed) || quoteRe.matches(trimmed)

    /** Membangun daftar bersarang dari item datar menurut indentasi. */
    private fun buildList(items: List<RawItem>, from: Int, to: Int): List<Block.ListBlock> {
        val result = ArrayList<Block.ListBlock>()
        var i = from
        while (i < to) {
            val base = items[i].indent
            val ordered = items[i].ordered
            val start = items[i].number
            val built = ArrayList<ListItem>()
            while (i < to && items[i].indent >= base) {
                if (items[i].indent == base && items[i].ordered != ordered) break
                val item = items[i]
                var j = i + 1
                while (j < to && items[j].indent > base) j++
                val children = if (j > i + 1) buildList(items, i + 1, j) else emptyList()
                built += ListItem(Inlines.parse(item.text.toString()), children)
                i = j
            }
            result += Block.ListBlock(ordered, start, built)
        }
        return result
    }

    private fun paragraph(lines: List<String>, from: Int, out: MutableList<Block>): Int {
        val buf = ArrayList<String>()
        var i = from
        while (i < lines.size) {
            val line = lines[i]
            if (line.isBlank()) break
            val startsOtherBlock = fenceRe.matches(line) || headingRe.matches(line) || quoteRe.matches(line) ||
                ruleRe.matches(line) || isTableStart(lines, i)
            if (i > from && startsOtherBlock) break
            buf += line.trimEnd()
            i++
        }
        out += Block.Paragraph(Inlines.parse(buf.joinToString("\n")))
        return i
    }
}

object Inlines {
    private val safeSchemes = listOf("http://", "https://", "mailto:")
    private const val TRAILING = ".,;:!?'\"]"

    fun parse(s: String): List<Inline> {
        val out = ArrayList<Inline>()
        val buf = StringBuilder()

        fun flush() {
            if (buf.isNotEmpty()) {
                out += Inline.Text(buf.toString())
                buf.clear()
            }
        }

        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '\\' && i + 1 < s.length && s[i + 1] in "\\`*_{}[]()#+-.!~|<>" -> {
                    buf.append(s[i + 1])
                    i += 2
                }
                c == '`' -> {
                    val n = s.run {
                        var k = i
                        while (k < length && this[k] == '`') k++
                        k - i
                    }
                    val close = findBacktickClose(s, i + n, n)
                    if (close < 0) {
                        buf.append("`".repeat(n))
                        i += n
                    } else {
                        flush()
                        var code = s.substring(i + n, close)
                        if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.isNotBlank()) {
                            code = code.substring(1, code.length - 1)
                        }
                        out += Inline.Code(code)
                        i = close + n
                    }
                }
                c == '~' && s.startsWith("~~", i) -> {
                    val close = s.indexOf("~~", i + 2)
                    if (close > i + 2 && !s[i + 2].isWhitespace()) {
                        flush()
                        out += Inline.Strike(parse(s.substring(i + 2, close)))
                        i = close + 2
                    } else {
                        buf.append("~~")
                        i += 2
                    }
                }
                c == '*' || c == '_' -> {
                    val consumed = emphasis(s, i, out, ::flush)
                    if (consumed > 0) {
                        i += consumed
                    } else {
                        buf.append(c)
                        i++
                    }
                }
                c == '[' -> {
                    val link = linkAt(s, i)
                    if (link == null) {
                        buf.append(c)
                        i++
                    } else {
                        flush()
                        out += Inline.Link(parse(link.text), link.url)
                        i = link.end
                    }
                }
                c == '<' && isAutolink(s, i) -> {
                    val end = s.indexOf('>', i)
                    flush()
                    val url = s.substring(i + 1, end)
                    out += Inline.Link(listOf(Inline.Text(url)), url)
                    i = end + 1
                }
                c == 'h' && startsUrl(s, i) -> {
                    val url = bareUrl(s, i)
                    flush()
                    out += Inline.Link(listOf(Inline.Text(url)), url)
                    i += url.length
                }
                else -> {
                    buf.append(c)
                    i++
                }
            }
        }
        flush()
        return out
    }

    private fun findBacktickClose(s: String, from: Int, n: Int): Int {
        var k = from
        while (k < s.length) {
            if (s[k] == '`') {
                var run = 0
                while (k + run < s.length && s[k + run] == '`') run++
                if (run == n) return k
                k += run
            } else {
                k++
            }
        }
        return -1
    }

    /** Mengembalikan jumlah karakter yang dikonsumsi, atau 0 bila bukan penekanan yang sah. */
    private fun emphasis(s: String, i: Int, out: MutableList<Inline>, flush: () -> Unit): Int {
        val ch = s[i]
        var k = 0
        while (i + k < s.length && s[i + k] == ch) k++
        if (k > 3) return 0
        val after = i + k
        if (after >= s.length || s[after].isWhitespace()) return 0
        if (ch == '_' && i > 0 && s[i - 1].isLetterOrDigit()) return 0
        val delim = ch.toString().repeat(k)
        var close = s.indexOf(delim, after)
        while (close >= 0) {
            val validClose = !s[close - 1].isWhitespace() && close > after &&
                (ch != '_' || close + k >= s.length || !s[close + k].isLetterOrDigit()) &&
                (close + k >= s.length || s[close + k] != ch)
            if (validClose) break
            close = s.indexOf(delim, close + 1)
        }
        if (close < 0) return 0
        val inner = parse(s.substring(after, close))
        flush()
        out += when (k) {
            1 -> Inline.Italic(inner)
            2 -> Inline.Bold(inner)
            else -> Inline.Bold(listOf(Inline.Italic(inner)))
        }
        return close + k - i
    }

    private data class LinkMatch(val text: String, val url: String, val end: Int)

    private fun linkAt(s: String, i: Int): LinkMatch? {
        var depth = 0
        var k = i
        while (k < s.length) {
            when (s[k]) {
                '[' -> depth++
                ']' -> {
                    depth--
                    if (depth == 0) break
                }
            }
            k++
        }
        if (k >= s.length || k + 1 >= s.length || s[k + 1] != '(') return null
        val close = s.indexOf(')', k + 2)
        if (close < 0) return null
        val url = s.substring(k + 2, close).trim().substringBefore(' ')
        if (safeSchemes.none { url.startsWith(it, ignoreCase = true) }) return null
        return LinkMatch(s.substring(i + 1, k), url, close + 1)
    }

    private fun isAutolink(s: String, i: Int): Boolean {
        val end = s.indexOf('>', i)
        if (end < 0) return false
        val inner = s.substring(i + 1, end)
        return inner.none { it.isWhitespace() } && safeSchemes.any { inner.startsWith(it, ignoreCase = true) }
    }

    private fun startsUrl(s: String, i: Int): Boolean =
        (s.startsWith("https://", i) || s.startsWith("http://", i)) && (i == 0 || !s[i - 1].isLetterOrDigit())

    private fun bareUrl(s: String, i: Int): String {
        var end = i
        while (end < s.length && !s[end].isWhitespace() && s[end] != '<') end++
        var url = s.substring(i, end)
        while (url.isNotEmpty()) {
            val last = url.last()
            val unbalancedParen = last == ')' && url.count { it == ')' } > url.count { it == '(' }
            if (last in TRAILING || unbalancedParen) url = url.dropLast(1) else break
        }
        return url
    }
}
