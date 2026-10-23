package app.aios.android.push

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.aios.android.MainActivity
import app.aios.android.R
import app.aios.android.data.auth.TokenStore
import app.aios.android.link.PushKeys
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Menerima FCM. Saat aplikasi tertutup, sistem sendiri menampilkan notifikasi (payload `notification` dengan
 * `channel_id` dari gateway) dan ketukan membuka MainActivity dengan data sebagai extras. Saat aplikasi terbuka,
 * `onMessageReceived` dipanggil dan notifikasi dibuat di sini dengan tujuan yang sama.
 * Payload hanya berisi judul dan ID; isi diambil aplikasi setelah dibuka.
 */
@AndroidEntryPoint
class AiosMessagingService : FirebaseMessagingService() {
    @Inject lateinit var registrar: PushRegistrar

    @Inject lateinit var tokens: TokenStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        scope.launch { registrar.onNewToken(tokens.current()?.deviceId, token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: return
        if (!canNotify()) return
        val type = message.data[PushKeys.TYPE]
        val open = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        message.data.forEach { (key, value) -> open.putExtra(key, value) }
        val pending = PendingIntent.getActivity(
            this,
            message.messageId.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(this, NotificationChannels.forType(type))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(this).notify(message.messageId.hashCode(), notification)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun canNotify(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
}
