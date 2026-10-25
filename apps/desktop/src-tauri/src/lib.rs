//! Cangkang Tauri yang tipis: semua logika aplikasi ada di TypeScript. Rust hanya menyediakan hal yang
//! tidak bisa dilakukan webview dengan aman: penyimpanan rahasia di Windows Credential Manager dan nama perangkat.
//! HTTP dan WebSocket ke gateway lewat plugin resmi (klien Rust, bukan fetch webview) supaya CORS tetap tertutup
//! dan header Authorization bisa dipasang saat handshake WebSocket. Pratinjau artifact disajikan dari origin
//! terpisah lewat custom protocol (lihat artifact.rs).

mod artifact;
mod worker;

use keyring::Entry;

/// Nama layanan di Credential Manager; entri tampil sebagai `app.aios.desktop/<kunci>`.
const SERVICE: &str = "app.aios.desktop";

/// Kunci hanya huruf kecil, angka, `_` dan `-` (maks. 32): perintah ini tidak boleh jadi jalan membaca entri lain.
fn entry(key: &str) -> Result<Entry, String> {
    let valid = !key.is_empty()
        && key.len() <= 32
        && key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-');
    if !valid {
        return Err("kunci kredensial tidak valid".into());
    }
    Entry::new(SERVICE, key).map_err(|_| "penyimpanan kredensial tidak tersedia".to_string())
}

// Pesan error sengaja generik: tidak pernah memuat nilai rahasia.

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("gagal membaca kredensial".into()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|_| "gagal menyimpan kredensial".to_string())
}

#[tauri::command]
fn secret_remove(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("gagal menghapus kredensial".into()),
    }
}

/// Nama PC untuk daftar perangkat di server.
#[tauri::command]
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Windows PC".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(worker::WorkerState::default())
        .manage(artifact::ArtifactStore::default())
        .register_uri_scheme_protocol("aiosartifact", |ctx, request| {
            use tauri::Manager;
            ctx.app_handle()
                .state::<artifact::ArtifactStore>()
                .respond(request.uri().path())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Jendela Quick Ask tersembunyi tidak boleh menahan aplikasi tetap hidup setelah jendela utama ditutup.
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                use tauri::Manager;
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_set,
            secret_remove,
            device_name,
            worker::worker_connect_info,
            artifact::artifact_put
        ])
        .build(tauri::generate_context!())
        .expect("aplikasi gagal dibangun");

    app.run(|handle, event| {
        // Worker ikut berhenti bersama aplikasi (proses anaknya dimatikan oleh worker sendiri).
        if let tauri::RunEvent::Exit = event {
            use tauri::Manager;
            handle.state::<worker::WorkerState>().shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kunci_valid_diterima() {
        assert!(entry("session").is_ok());
        assert!(entry("a-b_9").is_ok());
    }

    #[test]
    fn kunci_tidak_valid_ditolak() {
        for key in ["", "Session", "a b", "../x", "a/b", &"k".repeat(33)] {
            assert!(entry(key).is_err(), "harus ditolak: {key:?}");
        }
    }
}
