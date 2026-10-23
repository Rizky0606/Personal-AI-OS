package app.aios.android.data.auth

import android.content.Context
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import app.aios.android.data.api.TokenPair
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Token disimpan di DataStore; nilai rahasia (access dan refresh token) dienkripsi AES-256-GCM dengan
 * Tink. Keyset-nya dibungkus kunci Android Keystore, jadi berkas DataStore saja tidak cukup untuk membacanya.
 */
class EncryptedTokenStore(
    private val dataStore: DataStore<Preferences>,
    private val aead: Aead
) : TokenStore {
    private object Keys {
        val serverUrl = stringPreferencesKey("server_url")
        val lastServerUrl = stringPreferencesKey("last_server_url")
        val access = stringPreferencesKey("access_token_enc")
        val refresh = stringPreferencesKey("refresh_token_enc")
        val expiresAt = longPreferencesKey("access_expires_at_ms")
        val deviceId = stringPreferencesKey("device_id")
        val deviceName = stringPreferencesKey("device_name")
    }

    override val session: Flow<StoredSession?> = dataStore.data.map { it.toSession() }

    override val lastServerUrl: Flow<String?> = dataStore.data.map { it[Keys.lastServerUrl] }

    override suspend fun current(): StoredSession? = session.first()

    override suspend fun lastServerUrlOnce(): String? = lastServerUrl.first()

    override suspend fun save(session: StoredSession) {
        dataStore.edit {
            it[Keys.serverUrl] = session.serverUrl
            it[Keys.lastServerUrl] = session.serverUrl
            it[Keys.access] = encrypt(Keys.access.name, session.accessToken)
            it[Keys.refresh] = encrypt(Keys.refresh.name, session.refreshToken)
            it[Keys.expiresAt] = session.accessExpiresAtMs
            it[Keys.deviceId] = session.deviceId
            it[Keys.deviceName] = session.deviceName
        }
    }

    override suspend fun updateTokens(tokens: TokenPair, nowMs: Long) {
        dataStore.edit {
            if (it[Keys.refresh] == null) return@edit
            it[Keys.access] = encrypt(Keys.access.name, tokens.accessToken)
            it[Keys.refresh] = encrypt(Keys.refresh.name, tokens.refreshToken)
            it[Keys.expiresAt] = nowMs + tokens.expiresIn * MILLIS_PER_SECOND
        }
    }

    override suspend fun clear() {
        dataStore.edit {
            it.remove(Keys.serverUrl)
            it.remove(Keys.access)
            it.remove(Keys.refresh)
            it.remove(Keys.expiresAt)
            it.remove(Keys.deviceId)
            it.remove(Keys.deviceName)
        }
    }

    private fun Preferences.toSession(): StoredSession? {
        val access = this[Keys.access]?.let { decrypt(Keys.access.name, it) } ?: return null
        val refresh = this[Keys.refresh]?.let { decrypt(Keys.refresh.name, it) } ?: return null
        return StoredSession(
            serverUrl = this[Keys.serverUrl] ?: return null,
            accessToken = access,
            refreshToken = refresh,
            accessExpiresAtMs = this[Keys.expiresAt] ?: 0L,
            deviceId = this[Keys.deviceId] ?: return null,
            deviceName = this[Keys.deviceName] ?: ""
        )
    }

    private fun encrypt(name: String, plain: String): String =
        Base64.encodeToString(aead.encrypt(plain.toByteArray(), name.toByteArray()), Base64.NO_WRAP)

    /** Gagal dekripsi (kunci Keystore hilang, data rusak) dianggap tidak ada sesi, bukan crash. */
    private fun decrypt(name: String, encoded: String): String? = runCatching {
        String(aead.decrypt(Base64.decode(encoded, Base64.NO_WRAP), name.toByteArray()))
    }.getOrNull()

    companion object {
        private const val MILLIS_PER_SECOND = 1000L

        fun createAead(context: Context): Aead {
            AeadConfig.register()
            val handle = AndroidKeysetManager.Builder()
                .withSharedPref(context, "aios_keyset", "aios_keyset_prefs")
                .withKeyTemplate(KeyTemplates.get("AES256_GCM"))
                .withMasterKeyUri("android-keystore://aios_master_key")
                .build()
                .keysetHandle
            return handle.getPrimitive(RegistryConfiguration.get(), Aead::class.java)
        }
    }
}
