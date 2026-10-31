@file:Suppress("MaxLineLength")
package app.aios.android

import app.aios.android.ui.chat.markdown.Block
import app.aios.android.ui.chat.markdown.Inline
import app.aios.android.ui.chat.markdown.Inlines
import app.aios.android.ui.chat.markdown.Markdown
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownTest {
    private fun t(s: String) = Inline.Text(s)

    @Test
    fun `paragraf dipisah baris kosong, baris tunggal dipertahankan`() {
        val blocks = Markdown.parse("Satu\nDua\n\nTiga")
        assertEquals(
            listOf(Block.Paragraph(listOf(t("Satu\nDua"))), Block.Paragraph(listOf(t("Tiga")))),
            blocks
        )
    }

    @Test
    fun `judul tingkat 1 sampai 6`() {
        val blocks = Markdown.parse("# A\n### B ###\n###### C")
        assertEquals(listOf(1, 3, 6), blocks.map { (it as Block.Heading).level })
        assertEquals(listOf(t("B")), (blocks[1] as Block.Heading).inlines)
    }

    @Test
    fun `blok kode berpagar dengan bahasa, isi tidak diurai sebagai markdown`() {
        val code = Markdown.parse(
            "Contoh:\n```kotlin\nval x = **1**\n# bukan judul\n```\nSesudah"
        ).filterIsInstance<Block.Code>().single()
        assertEquals("kotlin", code.language)
        assertEquals("val x = **1**\n# bukan judul", code.code)
        assertTrue(code.closed)
    }

    @Test
    fun `aios-ui fenced JSON validasi dan unsupported tetap code biasa`() {
        val valid = """{"version":1,"components":[{"id":"m","type":"metric","label":"Nilai","value":42}]}"""
        val result = app.aios.android.ui.chat.markdown.parseRichAnswer(valid)
        assertTrue(result is app.aios.android.ui.chat.markdown.RichAnswerParse.Valid)
        assertTrue(app.aios.android.ui.chat.markdown.parseRichAnswer("""{"version":1,"components":[{"id":"x","type":"chart"}]}""") is app.aios.android.ui.chat.markdown.RichAnswerParse.Unsupported)
        assertTrue(app.aios.android.ui.chat.markdown.parseRichAnswer("{".repeat(20_000)) is app.aios.android.ui.chat.markdown.RichAnswerParse.Unsupported)
    }

    @Test
    fun `blok kode yang belum ditutup saat streaming tetap berupa kode`() {
        val blocks = Markdown.parse("```py\nprint(1)\nprint(2")
        val code = blocks.single() as Block.Code
        assertEquals("print(1)\nprint(2", code.code)
        assertEquals(false, code.closed)
    }

    @Test
    fun `fence tilde dan fence panjang`() {
        val code = Markdown.parse("~~~\na\n~~~").single() as Block.Code
        assertEquals("a", code.code)
        val longer = Markdown.parse("````\n```\ndalam\n```\n````").single() as Block.Code
        assertEquals("```\ndalam\n```", longer.code)
    }

    @Test
    fun `daftar bullet dan bernomor, dengan sarang`() {
        val bullets = Markdown.parse("- satu\n- dua\n  - anak a\n  - anak b\n- tiga").single() as Block.ListBlock
        assertEquals(false, bullets.ordered)
        assertEquals(3, bullets.items.size)
        val nested = bullets.items[1].children.single() as Block.ListBlock
        assertEquals(listOf(listOf(t("anak a")), listOf(t("anak b"))), nested.items.map { it.inlines })

        val numbered = Markdown.parse("3. c\n4. d").single() as Block.ListBlock
        assertTrue(numbered.ordered)
        assertEquals(3, numbered.start)
    }

    @Test
    fun `baris lanjutan item daftar digabung`() {
        val list = Markdown.parse("- panjang\n  lanjut\n- lain").single() as Block.ListBlock
        assertEquals(listOf(t("panjang\nlanjut")), list.items[0].inlines)
    }

    @Test
    fun `kutipan dan garis`() {
        val blocks = Markdown.parse("> kutip **tebal**\n> dua\n\n---")
        val quote = blocks[0] as Block.Quote
        assertEquals(1, quote.blocks.size)
        assertEquals(Block.Rule, blocks[1])
    }

    @Test
    fun `tabel dengan header dan baris`() {
        val table = Markdown.parse("| Nama | Nilai |\n| --- | ---: |\n| a | 1 |\n| b | `2` |").single() as Block.Table
        assertEquals(listOf(listOf(t("Nama")), listOf(t("Nilai"))), table.header)
        assertEquals(2, table.rows.size)
        assertEquals(listOf(Inline.Code("2")), table.rows[1][1])
    }

    @Test
    fun `inline tebal miring coret dan kode`() {
        assertEquals(
            listOf(
                t("a "),
                Inline.Bold(listOf(t("b"))),
                t(" "),
                Inline.Italic(listOf(t("c"))),
                t(" "),
                Inline.Strike(listOf(t("d"))),
                t(" "),
                Inline.Code("e")
            ),
            Inlines.parse("a **b** *c* ~~d~~ `e`")
        )
    }

    @Test
    fun `penekanan bersarang dan tiga bintang`() {
        assertEquals(listOf(Inline.Bold(listOf(Inline.Italic(listOf(t("x")))))), Inlines.parse("***x***"))
        assertEquals(
            listOf(Inline.Bold(listOf(t("tebal "), Inline.Italic(listOf(t("miring")))))),
            Inlines.parse("**tebal *miring***")
        )
    }

    @Test
    fun `underscore di tengah kata dan perkalian tidak dianggap penekanan`() {
        assertEquals(listOf(t("snake_case_name")), Inlines.parse("snake_case_name"))
        assertEquals(listOf(t("2 * 3 * 4")), Inlines.parse("2 * 3 * 4"))
    }

    @Test
    fun `kode inline melindungi markdown di dalamnya dan mendukung backtick ganda`() {
        assertEquals(listOf(Inline.Code("**bukan tebal**")), Inlines.parse("`**bukan tebal**`"))
        assertEquals(listOf(Inline.Code("a`b")), Inlines.parse("``a`b``"))
        assertEquals(listOf(t("`terbuka")), Inlines.parse("`terbuka"))
    }

    @Test
    fun `tautan hanya skema aman`() {
        assertEquals(
            listOf(Inline.Link(listOf(t("situs")), "https://contoh.com/a?b=1")),
            Inlines.parse("[situs](https://contoh.com/a?b=1)")
        )
        assertEquals(listOf(t("[klik](javascript:alert(1))")), Inlines.parse("[klik](javascript:alert(1))"))
        assertEquals(listOf(t("[x](data:text/html,hai)")), Inlines.parse("[x](data:text/html,hai)"))
    }

    @Test
    fun `URL telanjang menjadi tautan tanpa tanda baca penutup`() {
        val inlines = Inlines.parse("Lihat https://contoh.com/x, lalu (https://contoh.com/y).")
        val links = inlines.filterIsInstance<Inline.Link>().map { it.url }
        assertEquals(listOf("https://contoh.com/x", "https://contoh.com/y"), links)
    }

    @Test
    fun `escape backslash`() {
        assertEquals(listOf(t("*bukan miring*")), Inlines.parse("\\*bukan miring\\*"))
    }

    @Test
    fun `masukan kosong atau hanya spasi tidak menghasilkan blok`() {
        assertEquals(emptyList<Block>(), Markdown.parse(""))
        assertEquals(emptyList<Block>(), Markdown.parse("  \n \n"))
    }

    @Test
    fun `jawaban panjang dengan campuran blok diurai tanpa error`() {
        val doc = buildString {
            repeat(200) {
                append("## Bagian $it\n\nParagraf **penting** dengan [tautan](https://contoh.com/$it).\n\n")
                append("- a\n- b\n\n```js\nconsole.log($it)\n```\n\n")
            }
        }
        val blocks = Markdown.parse(doc)
        assertEquals(200 * 4, blocks.size)
    }
}
