package app.aios.android.data.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import app.aios.android.push.RegistrationStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

enum class ThemeMode { System, Light, Dark }

/** Preferensi non-rahasia. Rahasia ada di TokenStore. */
class SettingsStore(private val dataStore: DataStore<Preferences>) : RegistrationStore {
    private val themeKey = stringPreferencesKey("theme_mode")

    val themeMode: Flow<ThemeMode> = dataStore.data.map { prefs ->
        prefs[themeKey]?.let { name -> ThemeMode.entries.firstOrNull { it.name == name } } ?: ThemeMode.System
    }

    private val registeredPushKey = stringPreferencesKey("registered_push")
    private val promptShownKey = booleanPreferencesKey("notification_prompt_shown")

    /** "deviceId|token" terakhir yang berhasil didaftarkan ke server. */
    override suspend fun registeredPush(): String? = dataStore.data.first()[registeredPushKey]

    override suspend fun setRegisteredPush(value: String) {
        dataStore.edit { it[registeredPushKey] = value }
    }

    /** Penjelasan izin notifikasi hanya ditampilkan sekali. */
    val notificationPromptShown: Flow<Boolean> = dataStore.data.map { it[promptShownKey] == true }

    suspend fun markNotificationPromptShown() {
        dataStore.edit { it[promptShownKey] = true }
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        dataStore.edit { it[themeKey] = mode.name }
    }
}
