@file:Suppress("MaxLineLength")

package app.aios.android.ui.chat.markdown

import app.aios.android.ui.components.Hairline
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import app.aios.android.ui.theme.AiosTheme
import app.aios.ui.tokens.Tokens
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Composable
internal fun RichAnswerView(components: List<JsonObject>) {
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s12)) {
        components.forEach { component -> RichComponentView(component) }
    }
}

@Composable
private fun RichComponentView(value: JsonObject) {
    val colors = AiosTheme.colors
    val type = value.getValue("type").jsonPrimitive.content
    val shape = RoundedCornerShape(Tokens.Radius.sm)
    val tone = value["tone"]?.jsonPrimitive?.contentOrNull
    val borderColor = when (tone) {
        "info" -> colors.info
        "success" -> colors.success
        "warning" -> colors.warning
        "danger" -> colors.danger
        else -> colors.border
    }
    Column(
        modifier = Modifier.fillMaxWidth().border(
            Hairline,
            borderColor,
            shape
        ).background(colors.surface, shape).padding(Tokens.Space.s12),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s8)
    ) {
        when (type) {
            "metric" -> {
                Text(value.getValue("label").jsonPrimitive.content, style = AiosTheme.type.meta, color = colors.text2)
                val metric = value.getValue("value").jsonPrimitive
                Text(
                    metric.content + (
                        value["unit"]?.jsonPrimitive?.contentOrNull?.let {
                            " $it"
                        } ?: ""
                        ),
                    style = AiosTheme.type.section,
                    color = colors.text,
                    fontWeight = FontWeight.SemiBold
                )
                value["trend"]?.jsonObject?.let { trend ->
                    Text(
                        "${trend.getValue(
                            "direction"
                        ).jsonPrimitive.content} ${trend.getValue("value").jsonPrimitive.content}",
                        style = AiosTheme.type.chat,
                        color = colors.text2
                    )
                }
            }
            "table" -> {
                val columns = value.getValue("columns").jsonArray
                (listOf(columns) + value.getValue("rows").jsonArray.map { it.jsonArray })
                    .forEachIndexed { rowIndex, row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s12)) {
                            row.forEach { cell ->
                                Text(
                                    cell.jsonPrimitive.content,
                                    modifier = Modifier.weight(1f),
                                    style = AiosTheme.type.chat.copy(
                                        fontWeight = if (rowIndex == 0) FontWeight.SemiBold else FontWeight.Normal
                                    ),
                                    color = colors.text
                                )
                            }
                        }
                        if (rowIndex == 0) {
                            androidx.compose.foundation.layout.Box(
                                Modifier.fillMaxWidth().height(Hairline)
                            )
                        }
                    }
            }
            "checklist" -> {
                value["label"]?.jsonPrimitive?.contentOrNull?.let {
                    Text(it, style = AiosTheme.type.chat.copy(fontWeight = FontWeight.SemiBold), color = colors.text)
                }
                value.getValue("items").jsonArray.forEach { item ->
                    val entry = item.jsonObject
                    Text(
                        "${
                            if (entry.getValue("checked").jsonPrimitive.booleanOrNull == true) "☑" else "□"
                        } ${entry.getValue("label").jsonPrimitive.content}",
                        style = AiosTheme.type.chat,
                        color = colors.text
                    )
                }
            }
            "choices" -> {
                value["label"]?.jsonPrimitive?.contentOrNull?.let {
                    Text(it, style = AiosTheme.type.chat.copy(fontWeight = FontWeight.SemiBold), color = colors.text)
                }
                value.getValue("options").jsonArray.forEach { option ->
                    val item = option.jsonObject
                    Text(
                        "• ${item.getValue("label").jsonPrimitive.content}",
                        style = AiosTheme.type.chat,
                        color = colors.text
                    )
                    item["description"]?.jsonPrimitive?.contentOrNull?.let {
                        Text(
                            it,
                            style = AiosTheme.type.meta,
                            color = colors.text2
                        )
                    }
                }
            }
            "callout" -> {
                value["title"]?.jsonPrimitive?.contentOrNull?.let {
                    Text(it, style = AiosTheme.type.chat.copy(fontWeight = FontWeight.SemiBold), color = colors.text)
                }
                Text(value.getValue("text").jsonPrimitive.content, style = AiosTheme.type.chat, color = colors.text)
            }
            "steps" -> {
                value["label"]?.jsonPrimitive?.contentOrNull?.let {
                    Text(it, style = AiosTheme.type.chat.copy(fontWeight = FontWeight.SemiBold), color = colors.text)
                }
                value.getValue("items").jsonArray.forEachIndexed { index, step ->
                    val item = step.jsonObject
                    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s4)) {
                        Text(
                            "${index + 1}. ${item.getValue("title").jsonPrimitive.content}",
                            style = AiosTheme.type.chat.copy(fontWeight = FontWeight.SemiBold),
                            color = colors.text
                        )
                        Text(
                            item.getValue("text").jsonPrimitive.content,
                            style = AiosTheme.type.chat,
                            color = colors.text2
                        )
                    }
                }
            }
        }
    }
}
