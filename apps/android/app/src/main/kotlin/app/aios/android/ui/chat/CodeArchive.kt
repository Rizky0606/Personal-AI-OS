package app.aios.android.ui.chat

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Satu blok kode dari jawaban AI beserta path berkasnya di dalam zip. */
data class CodeFile(val path: String, val content: String)

/**
 * Mengemas blok kode di jawaban AI menjadi zip (Unduh ZIP), sama dengan desktop (`codeArchive.ts`): nama dari baris
 * pembuka blok (```jsx src/App.jsx atau title="src/App.jsx"), lalu komentar path di baris pertama, lalu nama bawaan.
 */
object CodeArchive {
    private val fenceOpen = Regex("""^ {0,3}(`{3,}|~{3,})(.*)$""")
    private val attrPath = Regex("""(?:title|file|filename|path)\s*=\s*["']?([^"'\s]+)""", RegexOption.IGNORE_CASE)
    private val firstLinePath =
        Regex("""^(?://|#|--|;)\s*(\S+)\s*$|^/\*\s*(\S+)\s*\*/$|^<!--\s*(\S+)\s*-->$""")
    private val pathLike = Regex("""^[\w@~./\\-]+\.[A-Za-z0-9]{1,10}$|^Dockerfile$|^Makefile$""")

    private val extensions = mapOf(
        "js" to "js", "javascript" to "js", "jsx" to "jsx", "ts" to "ts", "typescript" to "ts", "tsx" to "tsx",
        "py" to "py", "python" to "py", "html" to "html", "css" to "css", "scss" to "scss", "json" to "json",
        "md" to "md", "markdown" to "md", "sh" to "sh", "bash" to "sh", "shell" to "sh", "zsh" to "sh",
        "ps1" to "ps1", "powershell" to "ps1", "yaml" to "yaml", "yml" to "yaml", "toml" to "toml", "sql" to "sql",
        "java" to "java", "kotlin" to "kt", "kt" to "kt", "go" to "go", "rust" to "rs", "rs" to "rs", "c" to "c",
        "cpp" to "cpp", "cs" to "cs", "php" to "php", "rb" to "rb", "ruby" to "rb", "swift" to "swift",
        "dart" to "dart", "vue" to "vue", "svelte" to "svelte", "xml" to "xml", "env" to "env"
    )

    /** Path aman di dalam zip: garis miring maju, tanpa awalan "/" atau segmen "..". */
    fun safePath(raw: String): String =
        raw.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." && it != ".." }.joinToString("/")

    private fun pathFromInfo(info: String): String? {
        attrPath.find(info)?.groupValues?.get(1)?.let { return it }
        return info.trim().split(Regex("\\s+")).drop(1).firstOrNull { pathLike.matches(it) }
    }

    private fun pathFromFirstLine(code: String): String? {
        val match = firstLinePath.find(code.lineSequence().firstOrNull()?.trim().orEmpty()) ?: return null
        val candidate = match.groupValues.drop(1).firstOrNull { it.isNotEmpty() } ?: return null
        return candidate.takeIf { pathLike.matches(it) }
    }

    /** Semua blok kode berpagar di teks Markdown, beserta nama berkasnya (unik). */
    fun extract(markdown: String): List<CodeFile> {
        val lines = markdown.lines()
        val files = mutableListOf<CodeFile>()
        val used = mutableSetOf<String>()
        var i = 0
        while (i < lines.size) {
            val open = fenceOpen.find(lines[i])
            if (open == null) {
                i++
                continue
            }
            val fence = open.groupValues[1]
            val info = open.groupValues[2]
            val body = mutableListOf<String>()
            var j = i + 1
            while (j < lines.size) {
                val t = lines[j].trim()
                if (t.length >= fence.length && t.all { it == fence[0] }) break
                body += lines[j]
                j++
            }
            i = j + 1
            val content = body.joinToString("\n")
            if (content.isBlank()) continue

            val language = info.trim().split(Regex("\\s+")).firstOrNull()?.lowercase().orEmpty()
            val named = (pathFromInfo(info) ?: pathFromFirstLine(content))?.let(::safePath).orEmpty()
            val path = named.ifEmpty {
                val ext = extensions[language] ?: "txt"
                if (language == "dockerfile") "Dockerfile" else "berkas-${files.size + 1}.$ext"
            }
            var unique = path
            var n = 2
            while (unique in used) {
                unique = Regex("""(\.[^./]+)?$""").replaceFirst(path, "-$n$1")
                n++
            }
            used += unique
            files += CodeFile(unique, if (content.endsWith("\n")) content else "$content\n")
        }
        return files
    }

    /** Isi zip (deflate) untuk berkas-berkas ini; nama ditulis UTF-8. */
    fun zip(files: List<CodeFile>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out, Charsets.UTF_8).use { zip ->
            for (file in files) {
                zip.putNextEntry(ZipEntry(file.path))
                zip.write(file.content.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }
}
