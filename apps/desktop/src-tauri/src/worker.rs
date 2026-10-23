//! Worker sidecar: proses terpisah (Bun, satu .exe) yang menyentuh folder project dan menjalankan agent.
//! Rust hanya memulai dan mematikannya bersama aplikasi, lalu menyerahkan port dan token sekali pakai ke
//! webview. Semua logika lain ada di worker (TypeScript).

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Nama berkas sidecar di samping exe aplikasi (Tauri membuang akhiran target triple saat membundel).
const SIDECAR_EXE: &str = "aios-worker.exe";
const START_TIMEOUT: Duration = Duration::from_secs(10);
const STOP_GRACE: Duration = Duration::from_secs(3);

#[derive(Serialize)]
pub struct WorkerInfo {
    port: u16,
    token: String,
}

#[derive(Deserialize)]
struct Listening {
    event: String,
    port: u16,
}

struct Running {
    child: Child,
    /// Pipe stdin tetap terbuka selama aplikasi hidup; saat ditutup (juga bila aplikasi crash) worker berhenti.
    stdin: Option<ChildStdin>,
    port: u16,
    /// Token awal; diserahkan sekali ke webview lalu dikosongkan.
    token: Option<String>,
}

#[derive(Default)]
pub struct WorkerState(Mutex<Option<Running>>);

/// Port dari baris `{"event":"listening","port":N}` yang dicetak worker.
fn parse_listening(line: &str) -> Option<u16> {
    let parsed: Listening = serde_json::from_str(line.trim()).ok()?;
    (parsed.event == "listening" && parsed.port > 0).then_some(parsed.port)
}

/// 32 byte acak dari sistem operasi, dalam heksadesimal (64 karakter).
fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| "gagal membuat token acak".to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "lokasi aplikasi tidak diketahui".to_string())?;
    let path = exe
        .parent()
        .map(|dir| dir.join(SIDECAR_EXE))
        .ok_or_else(|| "lokasi aplikasi tidak diketahui".to_string())?;
    if path.exists() {
        Ok(path)
    } else {
        Err("worker tidak ditemukan; jalankan: pnpm --filter @aios/worker build:sidecar".into())
    }
}

fn start(app: &AppHandle) -> Result<Running, String> {
    let exe = sidecar_path()?;
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "folder data aplikasi tidak tersedia".to_string())?
        .join("worker");
    let token = random_token()?;

    let mut command = Command::new(exe);
    command
        .env("AIOS_WORKER_TOKEN", &token)
        .env("AIOS_WORKER_DATA_DIR", &data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: tanpa jendela konsol yang berkedip.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "worker gagal dijalankan".to_string())?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("stdout worker tidak tersedia")?;
    let stderr = child.stderr.take().ok_or("stderr worker tidak tersedia")?;

    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("{line}");
        }
    });

    // Baris pertama stdout membawa port; sisanya dikuras supaya pipe tidak penuh dan memblokir worker.
    let (tx, rx) = mpsc::channel::<u16>();
    std::thread::spawn(move || {
        let mut sent = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !sent {
                if let Some(port) = parse_listening(&line) {
                    sent = tx.send(port).is_ok();
                }
            }
        }
    });

    match rx.recv_timeout(START_TIMEOUT) {
        Ok(port) => Ok(Running {
            child,
            stdin,
            port,
            token: Some(token),
        }),
        Err(_) => {
            terminate(&mut Running {
                child,
                stdin,
                port: 0,
                token: None,
            });
            Err("worker tidak siap dalam 10 detik".into())
        }
    }
}

/// Menutup stdin supaya worker berhenti sendiri (mematikan proses anaknya), lalu memaksa bila terlambat.
fn terminate(running: &mut Running) {
    drop(running.stdin.take());
    let deadline = Instant::now() + STOP_GRACE;
    while Instant::now() < deadline {
        if matches!(running.child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    // taskkill /T mematikan seluruh pohon proses, termasuk proses anak worker.
    let _ = Command::new("taskkill")
        .args(["/PID", &running.child.id().to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = running.child.kill();
    let _ = running.child.wait();
}

impl WorkerState {
    /// Dipanggil saat aplikasi keluar.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut running) = guard.take() {
                terminate(&mut running);
            }
        }
    }
}

/// Port dan token sekali pakai untuk menyambung ke worker lokal. Pemanggilan pertama memakai proses yang
/// sudah berjalan; bila token awal sudah diserahkan (webview dimuat ulang dan rantai token hilang), worker
/// dimulai ulang dengan token baru.
#[tauri::command]
pub fn worker_connect_info(
    app: AppHandle,
    state: State<'_, WorkerState>,
) -> Result<WorkerInfo, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "status worker tidak tersedia".to_string())?;

    if let Some(running) = guard.as_mut() {
        let alive = matches!(running.child.try_wait(), Ok(None));
        if alive {
            if let Some(token) = running.token.take() {
                return Ok(WorkerInfo {
                    port: running.port,
                    token,
                });
            }
        }
    }
    if let Some(mut old) = guard.take() {
        terminate(&mut old);
    }

    let mut running = start(&app)?;
    let info = WorkerInfo {
        port: running.port,
        token: running.token.take().unwrap_or_default(),
    };
    *guard = Some(running);
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baris_listening_valid_menghasilkan_port() {
        assert_eq!(
            parse_listening(r#"{"event":"listening","port":51234,"version":1}"#),
            Some(51234)
        );
        assert_eq!(
            parse_listening("  {\"event\":\"listening\",\"port\":80}\r\n"),
            Some(80)
        );
    }

    #[test]
    fn baris_lain_diabaikan() {
        for line in [
            "",
            "bukan json",
            r#"{"event":"lain","port":80}"#,
            r#"{"event":"listening","port":0}"#,
            r#"{"event":"listening"}"#,
        ] {
            assert_eq!(parse_listening(line), None, "harus ditolak: {line:?}");
        }
    }

    #[test]
    fn token_acak_64_heksadesimal_dan_unik() {
        let a = random_token().expect("token");
        let b = random_token().expect("token");
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
