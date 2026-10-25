package app.aios.android

import app.aios.android.ui.chat.markdown.ArtifactKind
import app.aios.android.ui.chat.markdown.ArtifactPage
import app.aios.android.ui.chat.markdown.ArtifactTheme
import app.aios.android.ui.chat.markdown.PreparedReact
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ArtifactPageTest {
    private val theme =
        ArtifactTheme(dark = true, bg = "#0B1326", surface = "#131B2E", text = "#DAE2FD", danger = "#FFB4AB")

    @Test
    fun `jenis artifact dari bahasa atau path, dan blok yang tidak bisa berdiri sendiri ditolak`() {
        assertEquals(ArtifactKind.Html, ArtifactPage.kind("index.html", "<p>x</p>"))
        assertEquals(ArtifactKind.React, ArtifactPage.kind("src/App.jsx", "export default function App() {}"))
        assertEquals(ArtifactKind.Mermaid, ArtifactPage.kind("mermaid", "graph TD; A-->B"))
        assertEquals(ArtifactKind.Svg, ArtifactPage.kind("svg", "<svg viewBox=\"0 0 1 1\"></svg>"))
        assertNull(ArtifactPage.kind("js", "console.log(1)"))
        assertNull(ArtifactPage.kind("jsx", "<div>hanya elemen</div>"))
        assertNull(ArtifactPage.kind("svg", "bukan svg"))
        assertNull(ArtifactPage.kind("html", "  "))
    }

    @Test
    fun `React - impor dibuang, export default diganti, komponen di-mount`() {
        val out = ArtifactPage.prepareReact(
            "import React, { useState } from 'react';\nimport './App.css';\n\n" +
                "export default function Todo() {\n  const [n] = useState(0);\n  return <p>{n}</p>;\n}\n"
        ) as PreparedReact.Ok
        assertEquals("Todo", out.component)
        assertFalse(out.source.contains("import"))
        assertFalse(out.source.contains("export"))
        assertTrue(out.source.startsWith("const { useState,"))
        assertTrue(out.source.contains("render(React.createElement(Todo))"))
    }

    @Test
    fun `React - export default identifier, anonim, panah, dan galat yang jelas`() {
        fun component(code: String) = (ArtifactPage.prepareReact(code) as PreparedReact.Ok).component
        assertEquals("Card", component("const Card = () => <b/>;\nexport default Card;"))
        assertEquals("__AiosApp", component("export default function () { return <i/>; }"))
        val arrow = ArtifactPage.prepareReact("export default () => <u/>;") as PreparedReact.Ok
        assertTrue(arrow.source.contains("const __AiosApp = () =>"))
        val other = ArtifactPage.prepareReact("import { Bell } from 'lucide-react';\nexport default function A() {}")
        assertTrue((other as PreparedReact.Error).message.contains("lucide-react"))
        assertTrue(ArtifactPage.prepareReact("const x = 1;") is PreparedReact.Error)
    }

    @Test
    fun `halaman - token, escape Mermaid, dan literal JS yang tidak bisa menutup script`() {
        val html = ArtifactPage.build(ArtifactKind.Html, "<h1>Halo</h1>", theme)
        assertTrue(html.contains("<h1>Halo</h1>") && html.contains("background: #0B1326"))
        val mermaid = ArtifactPage.build(ArtifactKind.Mermaid, "graph TD\n  A[\"<b>x</b>\"] --> B", theme)
        assertTrue(mermaid.contains("&lt;b&gt;x&lt;/b&gt;"))
        assertTrue(mermaid.contains("integrity=\"${ArtifactPage.mermaid.integrity}\""))
        val react = ArtifactPage.build(
            ArtifactKind.React,
            "export default function App() { return <p>{\"</script><script>alert(1)</script>\"}</p>; }",
            theme
        )
        assertEquals(Regex("<script").findAll(react).count(), Regex("</script>").findAll(react).count())
        assertFalse(react.contains("alert(1)</script>"))
        assertEquals("\"a\\u003c/b\\n\\\"\"", ArtifactPage.jsString("a</b\n\""))
    }

    @Test
    fun `URL dan hash CDN sama dengan desktop`() {
        val desktop = File("../../desktop/src/markdown/artifact.ts").readText()
        for (script in listOf(ArtifactPage.react, ArtifactPage.reactDom, ArtifactPage.babel, ArtifactPage.mermaid)) {
            assertTrue("src ${script.src}", desktop.contains("'${script.src}'"))
            assertTrue("integrity ${script.src}", desktop.contains("'${script.integrity}'"))
        }
    }
}
