package app.aios.android.data.db

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/**
 * Cache offline. Server adalah sumber kebenaran; baris di sini hanya salinan supaya layar terbuka
 * instan dan terbaca saat offline. Skema versi 1 -> 2 dibuang dan dibangun ulang (cache, bukan data pengguna).
 */
@Entity(tableName = "cache_entry")
data class CacheEntry(
    @PrimaryKey val key: String,
    val json: String,
    val updatedAtMs: Long
)

@Entity(tableName = "conversation")
data class ConversationEntity(
    @PrimaryKey val id: String,
    val title: String,
    val surface: String,
    val projectId: String?,
    val pinned: Boolean,
    val archivedAt: String?,
    val createdAt: String,
    val updatedAt: String
)

/** Bagian pesan disimpan sebagai JSON agar tipe bagian baru tidak memaksa migrasi skema. */
@Entity(
    tableName = "message",
    indices = [Index("conversationId", "id")]
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val conversationId: String,
    val author: String,
    val partsJson: String,
    val agentRole: String?,
    val model: String?,
    val runId: String?,
    val createdAt: String
)

@Dao
interface CacheDao {
    @Query("SELECT * FROM cache_entry WHERE `key` = :key")
    suspend fun get(key: String): CacheEntry?

    @Upsert
    suspend fun put(entry: CacheEntry)

    @Query("DELETE FROM cache_entry")
    suspend fun clear()
}

@Dao
interface ChatDao {
    /** Sematan di atas, lalu yang terbaru. [query] sudah di-escape untuk LIKE (karakter escape `\`). */
    @Query(
        """
        SELECT * FROM conversation
        WHERE ((:archived = 1 AND archivedAt IS NOT NULL) OR (:archived = 0 AND archivedAt IS NULL))
          AND title LIKE '%' || :query || '%' ESCAPE '\'
        ORDER BY pinned DESC, updatedAt DESC
        """
    )
    fun observeConversations(query: String, archived: Int): Flow<List<ConversationEntity>>

    @Query("SELECT * FROM conversation WHERE id = :id")
    fun observeConversation(id: String): Flow<ConversationEntity?>

    @Query("SELECT * FROM conversation WHERE id = :id")
    suspend fun conversation(id: String): ConversationEntity?

    @Upsert
    suspend fun upsertConversations(items: List<ConversationEntity>)

    @Query("DELETE FROM conversation WHERE id = :id")
    suspend fun deleteConversationRow(id: String)

    @Query("DELETE FROM message WHERE conversationId = :id")
    suspend fun deleteMessages(id: String)

    @Transaction
    suspend fun deleteConversation(id: String) {
        deleteMessages(id)
        deleteConversationRow(id)
    }

    @Query("SELECT * FROM message WHERE conversationId = :conversationId ORDER BY id ASC")
    fun observeMessages(conversationId: String): Flow<List<MessageEntity>>

    @Upsert
    suspend fun upsertMessages(items: List<MessageEntity>)

    /** ID UUIDv7 urut waktu: `id >= fromId` = pesan itu dan semua sesudahnya. */
    @Query("DELETE FROM message WHERE conversationId = :conversationId AND id >= :fromId")
    suspend fun deleteMessagesFrom(conversationId: String, fromId: String)

    /** Pesan cache sejak [fromId] yang tidak ada lagi di server (dipotong dari perangkat lain). */
    @Query("DELETE FROM message WHERE conversationId = :conversationId AND id >= :fromId AND id NOT IN (:keep)")
    suspend fun deleteMissingFrom(conversationId: String, fromId: String, keep: List<String>)

    @Query("SELECT MIN(id) FROM message WHERE conversationId = :conversationId")
    suspend fun oldestMessageId(conversationId: String): String?

    @Query("DELETE FROM conversation")
    suspend fun clearConversations()

    @Query("DELETE FROM message")
    suspend fun clearMessages()

    @Transaction
    suspend fun clearChat() {
        clearMessages()
        clearConversations()
    }
}

@Database(
    entities = [CacheEntry::class, ConversationEntity::class, MessageEntity::class],
    version = 2,
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun cacheDao(): CacheDao

    abstract fun chatDao(): ChatDao
}
