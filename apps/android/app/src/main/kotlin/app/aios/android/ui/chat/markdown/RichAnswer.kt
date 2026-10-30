package app.aios.android.ui.chat.markdown

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed interface RichAnswerParse {
    data class Valid(val components: List<JsonObject>) : RichAnswerParse
    data object Unsupported : RichAnswerParse
}

private val richAnswerJson = Json { isLenient = false; allowTrailingComma = false }
private const val MAX_JSON_BYTES = 20 * 1024
private const val MAX_COMPONENTS = 12
private const val MAX_ITEMS = 20
private const val MAX_ROWS = 100
private const val MAX_TEXT = 4_000
private const val MAX_LABEL = 240
private val supportedKeys = mapOf(
    "metric" to setOf("id", "type", "label", "value", "unit", "tone", "trend"),
    "table" to setOf("id", "type", "columns", "rows"),
    "checklist" to setOf("id", "type", "label", "items"),
    "choices" to setOf("id", "type", "label", "mode", "options"),
    "callout" to setOf("id", "type", "tone", "title", "text"),
    "steps" to setOf("id", "type", "label", "items")
)

fun parseRichAnswer(source: String): RichAnswerParse {
    if (source.toByteArray(Charsets.UTF_8).size > MAX_JSON_BYTES) return RichAnswerParse.Unsupported
    return runCatching {
        val root = richAnswerJson.parseToJsonElement(source).jsonObject
        require(root.keys == setOf("version", "components") && root["version"]?.jsonPrimitive?.intOrNull == 1)
        val components = root["components"]?.jsonArray ?: error("components")
        require(components.isNotEmpty() && components.size <= MAX_COMPONENTS)
        val values = components.map { element ->
            val item = element.jsonObject
            val type = item["type"]?.jsonPrimitive?.contentOrNull ?: error("type")
            val allowed = supportedKeys[type] ?: error("unsupported component")
            require(item.keys.all(allowed::contains))
            requireId(item)
            validateComponent(type, item)
            item
        }
        RichAnswerParse.Valid(values)
    }.getOrElse { RichAnswerParse.Unsupported }
}

private fun validateComponent(type: String, item: JsonObject) {
    fun str(key: String, required: Boolean = true): String? {
        val value = item[key]?.jsonPrimitive?.contentOrNull
        require(!required || value != null)
        if (value != null) require(value.length <= if (key in setOf("label", "title")) MAX_LABEL else MAX_TEXT)
        return value
    }
    fun array(key: String): JsonArray = item[key]?.jsonArray ?: error(key)
    fun optionalLabel() = str("label", false)
    fun entries(key: String): JsonArray = array(key).also { require(it.size <= MAX_ITEMS) }
    when (type) {
        "metric" -> {
            str("label")
            val metric = item["value"] as? JsonPrimitive ?: error("value")
            require(metric.isString || metric.doubleOrNull != null)
            str("unit", false)
            item["tone"]?.let(::requireTone)
            item["trend"]?.jsonObject?.let { trend ->
                require(trend.keys == setOf("value", "direction", "tone"))
                require(trend["value"]?.jsonPrimitive?.doubleOrNull != null)
                require(trend["direction"]?.jsonPrimitive?.contentOrNull in setOf("up", "down", "flat"))
                requireTone(trend["tone"]!!)
            }
        }
        "table" -> {
            val columns = array("columns"); val rows = array("rows")
            require(columns.isNotEmpty() && columns.size <= 20 && rows.size <= MAX_ROWS)
            columns.forEach { bounded(it, MAX_LABEL) }
            rows.forEach { row -> row.jsonArray.let { cells -> require(cells.size == columns.size); cells.forEach { bounded(it, MAX_TEXT) } } }
        }
        "checklist" -> {
            optionalLabel()
            entries("items").forEach { element ->
                val entry = element.jsonObject
                require(entry.keys == setOf("id", "label", "checked")); requireId(entry)
                bounded(entry.getValue("label"), MAX_LABEL)
                require(entry["checked"]?.jsonPrimitive?.booleanOrNull != null)
            }
        }
        "choices" -> {
            optionalLabel()
            require(str("mode") in setOf("single", "multiple"))
            val options = entries("options"); require(options.isNotEmpty())
            options.forEach { element ->
                val entry = element.jsonObject
                require(entry.keys.all(setOf("id", "label", "description")::contains) && setOf("id", "label").all(entry::containsKey))
                requireId(entry); bounded(entry.getValue("label"), MAX_LABEL); entry["description"]?.let { bounded(it, MAX_TEXT) }
            }
        }
        "callout" -> {
            require(str("tone") in setOf("info", "success", "warning", "danger"))
            str("title", false); str("text")
        }
        "steps" -> {
            optionalLabel()
            entries("items").forEach { element ->
                val entry = element.jsonObject
                require(entry.keys.all(setOf("id", "title", "text", "done")::contains) && setOf("id", "title", "text").all(entry::containsKey))
                requireId(entry); bounded(entry.getValue("title"), MAX_LABEL); bounded(entry.getValue("text"), MAX_TEXT)
                entry["done"]?.let { require(it.jsonPrimitive.booleanOrNull != null) }
            }
        }
    }
}

private fun requireId(value: JsonObject) {
    require(value["id"]?.jsonPrimitive?.contentOrNull?.matches(Regex("[A-Za-z0-9_-]{1,80}")) == true)
}
private fun requireTone(value: JsonElement) {
    require(value.jsonPrimitive.contentOrNull in setOf("neutral", "info", "success", "warning", "danger"))
}
private fun bounded(value: JsonElement, max: Int) {
    require(value.jsonPrimitive.contentOrNull?.length?.let { it <= max } == true)
}
