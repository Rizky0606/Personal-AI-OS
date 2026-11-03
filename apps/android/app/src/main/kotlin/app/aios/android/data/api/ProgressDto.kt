@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package app.aios.android.data.api

import app.aios.android.data.realtime.TodoPhase
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Agregat panel Progres (`GET /conversations/:id/progress`, P2B/P6). Model mengikuti
 * packages/contracts/src/api-schemas.ts (`ConversationProgressSchema`); ubah bersama kontrak.
 */
@Serializable
data class ProgressPlan(val runId: String, val phases: List<TodoPhase>)

@Serializable(with = ProgressOutputSerializer::class)
sealed interface ProgressOutput {
    val runId: String
    val at: String

    @Serializable
    data class Image(
        override val runId: String,
        override val at: String,
        val fileId: String,
        val name: String,
        val mime: String,
        val size: Long
    ) : ProgressOutput

    @Serializable
    data class FileOutput(
        override val runId: String,
        override val at: String,
        val fileId: String,
        val name: String,
        val mime: String,
        val size: Long
    ) : ProgressOutput

    @Serializable
    data class Diff(
        override val runId: String,
        override val at: String,
        val files: List<DiffFile>
    ) : ProgressOutput

    @Serializable
    data class Research(
        override val runId: String,
        override val at: String,
        val researchId: String,
        val title: String
    ) : ProgressOutput

    /** Jenis output yang belum dikenal klien; diabaikan di UI, tidak merusak agregat. */
    @Serializable
    data class Unknown(override val runId: String = "", override val at: String = "") : ProgressOutput
}

@Serializable
data class DiffFile(val path: String, val additions: Int, val deletions: Int)

object ProgressOutputSerializer : JsonContentPolymorphicSerializer<ProgressOutput>(ProgressOutput::class) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<ProgressOutput> =
        when (element.jsonObject["kind"]?.jsonPrimitive?.content) {
            "image" -> ProgressOutput.Image.serializer()
            "file" -> ProgressOutput.FileOutput.serializer()
            "diff" -> ProgressOutput.Diff.serializer()
            "research" -> ProgressOutput.Research.serializer()
            else -> ProgressOutput.Unknown.serializer()
        }
}

@Serializable
data class ProgressMemoryItem(val id: String, val title: String)

@Serializable
data class ProgressMemory(val read: Int, val items: List<ProgressMemoryItem> = emptyList())

@Serializable
data class ProgressAttachment(val fileId: String, val name: String, val mime: String)

@Serializable
data class ProgressUsedDto(
    val skills: List<String> = emptyList(),
    val engine: String? = null,
    val model: String? = null,
    val memory: ProgressMemory = ProgressMemory(0, emptyList()),
    val attachments: List<ProgressAttachment> = emptyList(),
    val tools: List<String> = emptyList()
)

@Serializable
data class ConversationProgress(
    val plan: ProgressPlan? = null,
    val outputs: List<ProgressOutput> = emptyList(),
    val used: ProgressUsedDto = ProgressUsedDto()
)
