package app.aios.android

import android.app.Application
import app.aios.android.push.NotificationChannels
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class AiosApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationChannels.create(this)
    }
}
