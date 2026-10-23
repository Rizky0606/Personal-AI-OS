package app.aios.android.ui.research

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.aios.android.R
import app.aios.android.data.Connectivity
import app.aios.android.data.api.RESEARCH_STANDARD
import app.aios.android.data.api.toApiError
import app.aios.android.data.research.ResearchRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ResearchFormUi(
    val question: String = "",
    val depth: String = RESEARCH_STANDARD,
    val submitting: Boolean = false,
    @StringRes val questionError: Int? = null,
    @StringRes val formError: Int? = null
)

private const val MIN_QUESTION = 8
private const val MAX_QUESTION = 2000

@HiltViewModel
class ResearchFormViewModel @Inject constructor(
    private val repo: ResearchRepository,
    private val connectivity: Connectivity
) : ViewModel() {
    private val state = MutableStateFlow(ResearchFormUi())
    val ui: StateFlow<ResearchFormUi> = state.asStateFlow()

    private val created = Channel<String>(Channel.BUFFERED)

    /** ID job yang baru dibuat; layar berpindah ke progres. */
    val createdJob: Flow<String> = created.receiveAsFlow()

    fun onQuestion(value: String) = state.update {
        it.copy(question = value.take(MAX_QUESTION), questionError = null, formError = null)
    }

    fun onDepth(depth: String) = state.update { it.copy(depth = depth) }

    fun submit() {
        val current = state.value
        if (current.submitting) return
        val question = current.question.trim()
        if (question.length < MIN_QUESTION) {
            state.update { it.copy(questionError = R.string.research_error_question_short) }
            return
        }
        if (!connectivity.isConnected()) {
            state.update { it.copy(formError = R.string.error_offline) }
            return
        }
        state.update { it.copy(submitting = true, formError = null) }
        viewModelScope.launch {
            try {
                val job = repo.create(question, current.depth)
                created.trySend(job.id)
                state.update { ResearchFormUi() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                state.update {
                    it.copy(submitting = false, formError = e.toApiError(connectivity.isConnected()).messageRes)
                }
            }
        }
    }
}
