package app.aios.android.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/** Status koneksi internet perangkat. Antarmuka ini memudahkan tes ViewModel. */
interface Connectivity {
    val connected: Flow<Boolean>

    fun isConnected(): Boolean
}

/** Implementasi Android untuk state offline di semua layar. */
class ConnectivityObserver(context: Context) : Connectivity {
    private val manager = context.getSystemService(ConnectivityManager::class.java)

    override fun isConnected(): Boolean {
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    override val connected: Flow<Boolean> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(true)
            }

            override fun onLost(network: Network) {
                trySend(isConnected())
            }
        }
        trySend(isConnected())
        manager.registerNetworkCallback(
            NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(),
            callback
        )
        awaitClose { manager.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()
}
