package app.aios.android.ui.chat

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

enum class VoiceError { NotAvailable, NoSpeech, PermissionDenied, Failed }

/** Menyambung transkrip ke teks yang sudah ada di composer; hasilnya tetap bisa diedit sebelum dikirim. */
fun appendTranscript(base: String, transcript: String): String {
    val spoken = transcript.trim()
    if (spoken.isEmpty()) return base
    return if (base.isBlank()) spoken else base.trimEnd() + " " + spoken
}

/** Pemetaan kode error SpeechRecognizer ke jenis yang dipahami UI. */
internal fun voiceErrorFor(code: Int): VoiceError = when (code) {
    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> VoiceError.NoSpeech
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> VoiceError.PermissionDenied
    else -> VoiceError.Failed
}

/** Membungkus SpeechRecognizer; harus dipakai dari thread utama. */
class SpeechController(
    private val context: Context,
    private val onPartial: (String) -> Unit,
    private val onFinal: (String) -> Unit,
    private val onError: (VoiceError) -> Unit,
    private val onListening: (Boolean) -> Unit,
) {
    private var recognizer: SpeechRecognizer? = null

    private val listener = object : RecognitionListener {
        override fun onResults(results: Bundle?) {
            onListening(false)
            first(results)?.let(onFinal)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            first(partialResults)?.let(onPartial)
        }

        override fun onError(error: Int) {
            onListening(false)
            onError(voiceErrorFor(error))
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit

        override fun onBeginningOfSpeech() = Unit

        override fun onRmsChanged(rmsdB: Float) = Unit

        override fun onBufferReceived(buffer: ByteArray?) = Unit

        override fun onEndOfSpeech() = Unit

        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    private fun first(bundle: Bundle?): String? =
        bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }

    fun start() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            onError(VoiceError.NotAvailable)
            return
        }
        destroy()
        val created = SpeechRecognizer.createSpeechRecognizer(context)
        created.setRecognitionListener(listener)
        created.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "id-ID")
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true),
        )
        recognizer = created
        onListening(true)
    }

    /** Berhenti mendengarkan; hasil akhir tetap datang lewat onResults. */
    fun stop() {
        recognizer?.stopListening()
    }

    fun destroy() {
        recognizer?.destroy()
        recognizer = null
    }
}

class VoiceInputState(val listening: Boolean, val start: () -> Unit, val stop: () -> Unit)

/**
 * Input suara tahan-bicara. Teks yang diucapkan mengisi composer secara langsung (hasil sementara lalu akhir)
 * dan bisa diedit sebelum dikirim. Izin mikrofon diminta saat pertama kali ditekan.
 */
@Composable
fun rememberVoiceInput(
    currentDraft: () -> String,
    onDraft: (String) -> Unit,
    onError: (VoiceError) -> Unit,
): VoiceInputState {
    val context = LocalContext.current
    var listening by remember { mutableStateOf(false) }
    var base by remember { mutableStateOf("") }
    val draft by rememberUpdatedState(currentDraft)
    val setDraft by rememberUpdatedState(onDraft)
    val fail by rememberUpdatedState(onError)

    val controller = remember {
        SpeechController(
            context = context,
            onPartial = { setDraft(appendTranscript(base, it)) },
            onFinal = { setDraft(appendTranscript(base, it)) },
            onError = { fail(it) },
            onListening = { listening = it },
        )
    }
    DisposableEffect(controller) { onDispose { controller.destroy() } }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) fail(VoiceError.PermissionDenied)
    }
    val start = {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
            base = draft()
            controller.start()
        } else {
            permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    return VoiceInputState(listening, start) { controller.stop() }
}
