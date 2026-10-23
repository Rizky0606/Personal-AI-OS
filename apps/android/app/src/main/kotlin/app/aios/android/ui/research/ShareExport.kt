package app.aios.android.ui.research

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import app.aios.android.data.research.ExportedFile
import java.io.File

private const val EXPORT_DIR = "exports"

/**
 * Menulis laporan ke cache aplikasi lalu membuka share sheet. Berkas lama dihapus lebih dulu, jadi
 * laporan tidak menumpuk di perangkat; akses ke berkas hanya lewat izin baca sementara FileProvider.
 */
fun shareExport(context: Context, file: ExportedFile, chooserTitle: String) {
    val dir = File(context.cacheDir, EXPORT_DIR).apply {
        mkdirs()
        listFiles()?.forEach { it.delete() }
    }
    val target = File(dir, file.name).apply { writeBytes(file.bytes) }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
    val send = Intent(Intent.ACTION_SEND).apply {
        type = file.mime
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, chooserTitle).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
