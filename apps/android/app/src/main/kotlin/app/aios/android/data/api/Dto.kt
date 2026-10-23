package app.aios.android.data.api

import kotlinx.serialization.Serializable

/*
 * Model tulisan tangan yang mengikuti packages/contracts (api-schemas.ts dan entities.ts).
 * Jika kontrak berubah, ubah di sini dalam tugas yang sama. Field tak dikenal diabaikan agar
 * penambahan field di gateway tidak merusak aplikasi yang lebih lama.
 */

const val DEVICE_KIND_ANDROID = "android"

@Serializable
data class DeviceInfo(val name: String, val kind: String)

@Serializable
data class LoginRequest(
    val password: String,
    val totp: String,
    val device: DeviceInfo,
    val pushToken: String? = null
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class TokenPair(
    val accessToken: String,
    val refreshToken: String,
    /** Masa berlaku access token dalam detik. */
    val expiresIn: Int
)

@Serializable
data class Device(
    val id: String,
    val kind: String,
    val name: String,
    val scopes: List<String> = emptyList(),
    val lastSeenAt: String? = null,
    val createdAt: String
)

@Serializable
data class LoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
    val device: Device
) {
    val tokens: TokenPair get() = TokenPair(accessToken, refreshToken, expiresIn)
}

@Serializable
data class ProblemFieldError(val path: String, val message: String)

/** RFC 9457, sama dengan ProblemSchema di contracts. */
@Serializable
data class Problem(
    val type: String,
    val title: String,
    val status: Int,
    val detail: String,
    val code: String,
    val instance: String? = null,
    val errors: List<ProblemFieldError>? = null
)
