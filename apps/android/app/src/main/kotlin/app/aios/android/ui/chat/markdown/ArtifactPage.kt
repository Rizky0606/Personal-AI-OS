package app.aios.android.ui.chat.markdown

/**
 * Pratinjau artifact (A8), padanan `apps/desktop/src/markdown/artifact.ts`: blok HTML, SVG, satu komponen React,
 * atau diagram Mermaid dibangun menjadi satu halaman HTML utuh yang dijalankan di WebView terisolasi (tanpa jembatan
 * JS, tanpa akses berkas). React, Babel, dan Mermaid dimuat dari CDN dengan versi terkunci dan hash SRI.
 * Ubah kedua berkas bersamaan; `ArtifactPageTest` memeriksa URL dan hash CDN tetap sama dengan desktop.
 */
enum class ArtifactKind { Html, Svg, React, Mermaid }

/** Warna halaman dari token aplikasi, sebagai nilai CSS (mis. `#0B1326`). */
data class ArtifactTheme(
    val dark: Boolean,
    val bg: String,
    val surface: String,
    val text: String,
    val danger: String
)

data class CdnScript(val src: String, val integrity: String)

sealed interface PreparedReact {
    data class Ok(val source: String, val component: String) : PreparedReact
    data class Error(val message: String) : PreparedReact
}

object ArtifactPage {
    val react = CdnScript(
        "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
        "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z"
    )
    val reactDom = CdnScript(
        "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js",
        "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1"
    )
    val babel = CdnScript(
        "https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js",
        "sha384-x/ilTFv/u/eu6YSmkFDZl5V5Mm/pkxxcVv2cVJOrr1J0rvILhMvRBCy6yA75wYBj"
    )
    val mermaid = CdnScript(
        "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js",
        "sha384-rbtjAdnIQE/aQJGEgXrVUlMibdfTSa4PQju4HDhN3sR2PmaKFzhEafuePsl9H/9I"
    )

    private val kinds = mapOf(
        "html" to ArtifactKind.Html,
        "htm" to ArtifactKind.Html,
        "svg" to ArtifactKind.Svg,
        "jsx" to ArtifactKind.React,
        "tsx" to ArtifactKind.React,
        "react" to ArtifactKind.React,
        "mermaid" to ArtifactKind.Mermaid,
        "mmd" to ArtifactKind.Mermaid
    )
    private val reactComponent = Regex("""export\s+default\b|\bfunction\s+App\b|\b(?:const|let)\s+App\b""")
    private val svgTag = Regex("""<svg[\s>]""", RegexOption.IGNORE_CASE)
    private val fullDocument = Regex("""<!doctype|<html[\s>]""", RegexOption.IGNORE_CASE)

    /** Jenis artifact untuk blok kode ini, atau null bila tidak bisa dipratinjau. `language` boleh berupa path. */
    fun kind(language: String, code: String): ArtifactKind? {
        val token = language.trim().split(Regex("\\s+")).firstOrNull()?.lowercase().orEmpty()
        val kind = kinds[if ('.' in token) token.substringAfterLast('.') else token] ?: return null
        return when {
            code.isBlank() -> null
            kind == ArtifactKind.Svg && !svgTag.containsMatchIn(code) -> null
            // Potongan JSX tanpa komponen (mis. satu elemen) tidak bisa dirender sendiri.
            kind == ArtifactKind.React && !reactComponent.containsMatchIn(code) -> null
            else -> kind
        }
    }

    private val reactImport = Regex(
        """^\s*import\s+[\s\S]*?\s+from\s+['"]react(?:-dom(?:/client)?)?['"];?[ \t]*$""",
        RegexOption.MULTILINE
    )
    private val cssImport = Regex("""^\s*import\s+['"][^'"]+\.css['"];?[ \t]*$""", RegexOption.MULTILINE)
    private val otherImport = Regex("""^\s*import\s+[\s\S]*?from\s+['"]([^'"]+)['"]""", RegexOption.MULTILINE)
    private val namedDefault = Regex("""export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)""")
    private val anonymousDefault = Regex("""export\s+default\s+((?:async\s+)?function)\s*\(""")
    private val identDefault = Regex("""export\s+default\s+([A-Za-z_$][\w$]*)\s*;?[ \t]*$""", RegexOption.MULTILINE)
    private val namedExport = Regex(
        """^(\s*)export\s+(?=(?:const|let|var|function|class|interface|type|enum|async)\b)""",
        RegexOption.MULTILINE
    )
    private val appDeclaration = Regex("""\b(?:function|const|let)\s+App\b""")
    private val hooks = listOf(
        "useState", "useEffect", "useLayoutEffect", "useRef", "useMemo", "useCallback", "useReducer", "useContext",
        "useId", "useTransition", "useDeferredValue", "createContext", "forwardRef", "memo", "Fragment"
    )

    /** Sama dengan `prepareReact` di desktop: impor React dibuang, export default jadi deklarasi, lalu di-mount. */
    fun prepareReact(code: String): PreparedReact {
        var source = cssImport.replace(reactImport.replace(code, ""), "")
        otherImport.find(source)?.let {
            val name = it.groupValues[1]
            return PreparedReact.Error("Pratinjau hanya mendukung React; paket \"$name\" tidak tersedia.")
        }
        var component: String? = null
        val named = namedDefault.find(source)
        val anonymous = anonymousDefault.find(source)
        val ident = identDefault.find(source)
        when {
            named != null -> {
                component = named.groupValues[1]
                source = Regex("""export\s+default\s+(?=(?:async\s+)?function\b)""").replaceFirst(source, "")
            }
            anonymous != null -> {
                component = "__AiosApp"
                source = anonymousDefault.replaceFirst(source, "$1 __AiosApp(")
            }
            ident != null -> {
                component = ident.groupValues[1]
                source = source.replaceFirst(ident.value, "")
            }
            Regex("""export\s+default\s+""").containsMatchIn(source) -> {
                component = "__AiosApp"
                source = Regex("""export\s+default\s+""").replaceFirst(source, "const __AiosApp = ")
            }
        }
        source = namedExport.replace(source, "$1")
        if (component == null && appDeclaration.containsMatchIn(source)) component = "App"
        if (component == null) {
            return PreparedReact.Error("Tidak ada komponen untuk dirender (butuh export default atau App).")
        }
        val prelude = "const { ${hooks.joinToString(", ")} } = React;\n"
        val mount = "\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement($component));\n"
        return PreparedReact.Ok(prelude + source + mount, component)
    }

    private fun escapeHtml(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    private fun cssValue(value: String) = value.replace(Regex("[<>{};]"), "").trim()

    /** Literal string JS untuk disisipkan di dalam <script>: aman dari `</script>`. */
    fun jsString(text: String): String = buildString {
        append('"')
        for (ch in text) {
            when {
                ch == '"' -> append("\\\"")
                ch == '\\' -> append("\\\\")
                ch == '\n' -> append("\\n")
                ch == '\r' -> append("\\r")
                ch == '\t' -> append("\\t")
                ch == '<' -> append("\\u003c")
                ch < ' ' || ch.code == 0x2028 || ch.code == 0x2029 -> append("\\u%04x".format(ch.code))
                else -> append(ch)
            }
        }
        append('"')
    }

    private fun scriptTag(script: CdnScript) =
        """<script src="${script.src}" integrity="${script.integrity}" crossorigin="anonymous"></script>"""

    private fun baseStyle(theme: ArtifactTheme) = listOf(
        ":root { color-scheme: ${if (theme.dark) "dark" else "light"}; }",
        "html, body { margin: 0; min-height: 100%; background: ${cssValue(theme.bg)}; " +
            "color: ${cssValue(theme.text)}; " +
            "font-family: system-ui, -apple-system, \"Segoe UI\", sans-serif; font-size: 14px; line-height: 1.5; }",
        ".aios-error { margin: 16px; padding: 12px; border: 1px solid ${cssValue(theme.danger)}; border-radius: 8px; " +
            "color: ${cssValue(theme.danger)}; background: ${cssValue(theme.surface)}; white-space: pre-wrap; " +
            "font: 13px/1.5 ui-monospace, Consolas, monospace; }"
    ).joinToString("\n")

    private const val ERROR_HANDLER = """<script>
function aiosShowError(message) {
  var box = document.createElement('pre');
  box.className = 'aios-error';
  box.textContent = String(message);
  document.body.appendChild(box);
}
window.addEventListener('error', function (event) { aiosShowError(event.message || 'Galat saat menjalankan pratinjau.'); });
</script>"""

    private fun page(theme: ArtifactTheme, head: String, body: String) =
        "<!doctype html>\n<html lang=\"id\">\n<head>\n<meta charset=\"utf-8\">\n" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
            "<style>\n${baseStyle(theme)}\n</style>\n$ERROR_HANDLER\n$head\n</head>\n<body>\n$body\n</body>\n</html>\n"

    /** Halaman HTML lengkap untuk satu artifact. */
    fun build(kind: ArtifactKind, code: String, theme: ArtifactTheme): String = when (kind) {
        // Potongan HTML diberi jarak agar tidak menempel ke tepi layar; dokumen utuh dipakai apa adanya.
        ArtifactKind.Html -> if (fullDocument.containsMatchIn(code)) {
            code
        } else {
            page(theme, "<style>body { padding: 16px; box-sizing: border-box; }</style>", code)
        }
        ArtifactKind.Svg -> page(
            theme,
            "<style>body { display: grid; place-items: center; padding: 16px; box-sizing: border-box; } " +
                "svg { max-width: 100%; height: auto; }</style>",
            code
        )
        ArtifactKind.Mermaid -> page(
            theme,
            "<style>body { padding: 16px; } .mermaid { display: flex; justify-content: center; }</style>\n" +
                scriptTag(mermaid),
            "<pre class=\"mermaid\">${escapeHtml(code)}</pre>\n<script>\n" +
                "if (!window.mermaid) { aiosShowError('Mermaid gagal dimuat. Periksa koneksi internet.'); }\n" +
                "else {\n  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: " +
                "${jsString(if (theme.dark) "dark" else "default")} });\n" +
                "  mermaid.run().catch(function (error) {\n" +
                "    aiosShowError(error && error.message ? error.message : error);\n  });\n" +
                "}\n</script>"
        )
        ArtifactKind.React -> when (val prepared = prepareReact(code)) {
            is PreparedReact.Error ->
                page(theme, "", "<pre class=\"aios-error\">${escapeHtml(prepared.message)}</pre>")
            is PreparedReact.Ok -> page(
                theme,
                listOf(scriptTag(react), scriptTag(reactDom), scriptTag(babel)).joinToString("\n"),
                """<div id="root"></div>
<script>
(function () {
  if (!window.React || !window.ReactDOM || !window.Babel) { aiosShowError('React gagal dimuat. Periksa koneksi internet.'); return; }
  try {
    var output = Babel.transform(${jsString(prepared.source)}, {
      filename: 'App.tsx',
      presets: [['typescript', { isTSX: true, allExtensions: true }], 'react'],
    }).code;
    var script = document.createElement('script');
    script.textContent = output;
    document.body.appendChild(script);
  } catch (error) {
    aiosShowError(error && error.message ? error.message : error);
  }
})();
</script>"""
            )
        }
    }
}
