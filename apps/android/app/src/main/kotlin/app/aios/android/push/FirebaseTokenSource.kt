package app.aios.android.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Token FCM dari Firebase. Tanpa google-services.json Firebase tidak terinisialisasi dan `available` false. */
class FirebaseTokenSource(private val context: Context) : PushTokenSource {
    override val available: Boolean
        get() = FirebaseApp.getApps(context).isNotEmpty()

    override suspend fun token(): String? {
        if (!available) return null
        return suspendCancellableCoroutine { continuation ->
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                continuation.resume(task.takeIf { it.isSuccessful }?.result?.takeIf { it.isNotBlank() })
            }
        }
    }
}
