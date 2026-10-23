package app.aios.android.di

import android.content.Context
import android.os.Build
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.room.Room
import app.aios.android.BuildConfig
import app.aios.android.data.Connectivity
import app.aios.android.data.ConnectivityObserver
import app.aios.android.data.api.ChatApi
import app.aios.android.data.api.ScheduleApi
import app.aios.android.data.schedules.RemoteScheduleRepository
import app.aios.android.data.schedules.ScheduleRepository
import app.aios.android.data.api.DevicesApi
import app.aios.android.push.FirebaseTokenSource
import app.aios.android.push.PushRegistrar
import app.aios.android.push.PushTokenSource
import app.aios.android.data.api.ResearchApi
import app.aios.android.data.research.RemoteResearchRepository
import app.aios.android.data.research.ResearchRepository
import app.aios.android.data.chat.ChatRepository
import app.aios.android.data.chat.RoomChatRepository
import app.aios.android.data.db.ChatDao
import app.aios.android.data.realtime.Backoff
import app.aios.android.data.realtime.OkHttpWsTransport
import app.aios.android.data.realtime.RealtimeClient
import app.aios.android.data.realtime.RefresherTokenSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlin.random.Random
import app.aios.android.data.api.AuthInterceptor
import app.aios.android.data.api.BaseUrlInterceptor
import app.aios.android.data.api.PublicAuthApi
import app.aios.android.data.api.ServerEndpoint
import app.aios.android.data.api.SessionApi
import app.aios.android.data.api.TokenAuthenticator
import app.aios.android.data.auth.AuthRepository
import app.aios.android.data.auth.EncryptedTokenStore
import app.aios.android.data.auth.SessionEvents
import app.aios.android.data.auth.TokenRefresher
import app.aios.android.data.auth.TokenStore
import app.aios.android.data.db.AppDatabase
import app.aios.android.data.settings.SettingsStore
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

/** Basis semu; BaseUrlInterceptor menggantinya dengan alamat server dari pengguna. */
private const val PLACEHOLDER_BASE = "https://aios.invalid/v1/"
private const val CONNECT_TIMEOUT_S = 10L
private const val READ_TIMEOUT_S = 30L
private const val WS_PING_S = 20L
private const val JITTER_DIVISOR = 5

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Provides
    @Singleton
    @Named("session")
    fun sessionDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("session") }

    @Provides
    @Singleton
    @Named("settings")
    fun settingsDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("settings") }

    @Provides
    @Singleton
    fun tokenStore(
        @ApplicationContext context: Context,
        @Named("session") dataStore: DataStore<Preferences>
    ): TokenStore = EncryptedTokenStore(dataStore, EncryptedTokenStore.createAead(context))

    @Provides
    @Singleton
    fun settingsStore(@Named("settings") dataStore: DataStore<Preferences>) = SettingsStore(dataStore)

    @Provides
    @Singleton
    fun connectivity(@ApplicationContext context: Context): Connectivity = ConnectivityObserver(context)

    @Provides
    @Singleton
    fun serverEndpoint(store: TokenStore) = ServerEndpoint(load = { store.lastServerUrlOnce() })

    @Provides
    @Singleton
    fun sessionEvents() = SessionEvents()

    @Provides
    @Singleton
    @Named("bare")
    fun bareClient(endpoint: ServerEndpoint): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
        .readTimeout(READ_TIMEOUT_S, TimeUnit.SECONDS)
        .addInterceptor(BaseUrlInterceptor(endpoint))
        .build()

    @Provides
    @Singleton
    fun publicAuthApi(@Named("bare") client: OkHttpClient, json: Json): PublicAuthApi =
        retrofit(client, json).create(PublicAuthApi::class.java)

    @Provides
    @Singleton
    fun tokenRefresher(store: TokenStore, api: PublicAuthApi, events: SessionEvents) =
        TokenRefresher(store, api, events)

    @Provides
    @Singleton
    @Named("authed")
    fun authedClient(endpoint: ServerEndpoint, refresher: TokenRefresher): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
        .readTimeout(READ_TIMEOUT_S, TimeUnit.SECONDS)
        .addInterceptor(BaseUrlInterceptor(endpoint))
        .addInterceptor(AuthInterceptor(refresher))
        .authenticator(TokenAuthenticator(refresher))
        .build()

    @Provides
    @Singleton
    fun sessionApi(@Named("authed") client: OkHttpClient, json: Json): SessionApi =
        retrofit(client, json).create(SessionApi::class.java)

    @Provides
    @Singleton
    @Suppress("LongParameterList") // Penyedia Hilt: tiap parameter adalah dependensi yang dirakit.
    fun authRepository(
        store: TokenStore,
        publicApi: PublicAuthApi,
        sessionApi: SessionApi,
        endpoint: ServerEndpoint,
        events: SessionEvents,
        connectivity: Connectivity,
        chat: ChatRepository,
        pushSource: PushTokenSource,
        push: PushRegistrar
    ) = AuthRepository(
        store = store,
        publicApi = publicApi,
        sessionApi = sessionApi,
        endpoint = endpoint,
        events = events,
        deviceName = Build.MODEL.ifBlank { "Android" },
        allowCleartextLocal = BuildConfig.DEBUG,
        isConnected = connectivity::isConnected,
        resetUserData = chat::clearCache,
        pushToken = pushSource::token,
        onPushRegistered = push::markRegistered
    )

    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "aios.db")
            // Hanya cache: skema berubah = bangun ulang dari server, tanpa migrasi.
            .fallbackToDestructiveMigration(true)
            .build()

    @Provides
    fun chatDao(db: AppDatabase): ChatDao = db.chatDao()

    @Provides
    @Singleton
    fun chatApi(@Named("authed") client: OkHttpClient, json: Json): ChatApi =
        retrofit(client, json).create(ChatApi::class.java)

    @Provides
    @Singleton
    fun chatRepository(api: ChatApi, dao: ChatDao, json: Json): ChatRepository = RoomChatRepository(api, dao, json)

    @Provides
    @Singleton
    fun devicesApi(@Named("authed") client: OkHttpClient, json: Json): DevicesApi =
        retrofit(client, json).create(DevicesApi::class.java)

    @Provides
    @Singleton
    fun pushTokenSource(@ApplicationContext context: Context): PushTokenSource = FirebaseTokenSource(context)

    @Provides
    @Singleton
    fun pushRegistrar(source: PushTokenSource, api: DevicesApi, settings: SettingsStore) =
        PushRegistrar(source, api, settings)

    @Provides
    @Singleton
    fun scheduleApi(@Named("authed") client: OkHttpClient, json: Json): ScheduleApi =
        retrofit(client, json).create(ScheduleApi::class.java)

    @Provides
    @Singleton
    fun scheduleRepository(api: ScheduleApi): ScheduleRepository = RemoteScheduleRepository(api)

    @Provides
    @Singleton
    fun researchApi(@Named("authed") client: OkHttpClient, json: Json): ResearchApi =
        retrofit(client, json).create(ResearchApi::class.java)

    @Provides
    @Singleton
    fun researchRepository(api: ResearchApi): ResearchRepository = RemoteResearchRepository(api)

    @Provides
    @Singleton
    @Named("ws")
    fun wsClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
        // Soket hidup lama: tanpa batas baca, tetapi ping tiap 20 detik mendeteksi sambungan mati.
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(WS_PING_S, TimeUnit.SECONDS)
        .build()

    @Provides
    @Singleton
    fun realtimeClient(
        @Named("ws") client: OkHttpClient,
        endpoint: ServerEndpoint,
        refresher: TokenRefresher
    ): RealtimeClient = RealtimeClient(
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
        transport = OkHttpWsTransport(client, endpoint),
        tokens = RefresherTokenSource(refresher),
        backoff = Backoff(jitter = { it + Random.nextLong(it / JITTER_DIVISOR + 1) })
    )

    private fun retrofit(client: OkHttpClient, json: Json): Retrofit = Retrofit.Builder()
        .baseUrl(PLACEHOLDER_BASE)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json; charset=UTF-8".toMediaType()))
        .build()
}
