package app.aios.android

import app.aios.android.ui.chat.CodeArchive
import app.aios.android.ui.chat.CodeFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

class CodeArchiveTest {
    private val answer = listOf(
        "Berikut project-nya:",
        "```json package.json",
        "{ \"name\": \"todo\" }",
        "```",
        "```jsx title=\"src/App.jsx\"",
        "export default function App() {}",
        "```",
        "```css",
        "/* src/index.css */",
        "body { margin: 0; }",
        "```",
        "```bash",
        "npm install",
        "```",
        "```bash",
        "npm run dev",
        "```"
    ).joinToString("\n")

    @Test
    fun `nama dari baris pembuka, atribut title, komentar baris pertama, lalu nama bawaan unik`() {
        assertEquals(
            listOf("package.json", "src/App.jsx", "src/index.css", "berkas-4.sh", "berkas-5.sh"),
            CodeArchive.extract(answer).map { it.path }
        )
    }

    @Test
    fun `nama sama diberi akhiran, blok kosong dilewati, path tidak bisa keluar folder`() {
        val files = CodeArchive.extract("```js app.js\n1\n```\n```js app.js\n2\n```\n```\n\n```")
        assertEquals(listOf("app.js", "app-2.js"), files.map { it.path })
        assertEquals("etc/passwd", CodeArchive.safePath("../../etc/passwd"))
        assertEquals("src/App.jsx", CodeArchive.safePath("src\\App.jsx"))
        assertTrue(CodeArchive.extract("Hanya teks.").isEmpty())
    }

    @Test
    fun `zip berisi semua berkas dengan isi utuh dan nama UTF-8`() {
        val files = listOf(CodeFile("src/App.jsx", "héllo\n"), CodeFile("package.json", "{}\n"))
        val read = mutableMapOf<String, String>()
        ZipInputStream(ByteArrayInputStream(CodeArchive.zip(files)), Charsets.UTF_8).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                read[entry.name] = zip.readBytes().toString(Charsets.UTF_8)
            }
        }
        assertEquals(mapOf("src/App.jsx" to "héllo\n", "package.json" to "{}\n"), read)
    }
}
