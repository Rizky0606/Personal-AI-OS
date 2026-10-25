//! Pratinjau artifact (W16). Halaman HTML yang dibangun webview dari blok kode jawaban AI disimpan di memori lalu
//! disajikan lewat custom protocol `aiosartifact` (di Windows: `http://aiosartifact.localhost/<id>`). Origin-nya
//! berbeda dari aplikasi dan iframe-nya di-sandbox tanpa `allow-same-origin`, jadi skrip artifact tidak bisa
//! menyentuh DOM, penyimpanan, atau IPC aplikasi. CSP aplikasi sendiri melarang skrip inline (dan itu ikut berlaku
//! untuk iframe `srcdoc`), karena itu halaman perlu disajikan dari origin ini.

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::http::{header, Response, StatusCode};

/// Halaman yang disimpan; yang tertua dibuang. Cukup untuk beberapa pratinjau terbuka sekaligus.
const MAX_PAGES: usize = 32;
/// Batas ukuran satu halaman (2 MiB): jawaban chat jauh di bawah ini.
const MAX_BYTES: usize = 2 * 1024 * 1024;

/// Longgar untuk skrip dan sumber https (React, Babel, Mermaid dari CDN) karena batas keamanannya adalah origin
/// terpisah dan sandbox iframe; form dan `<base>` tetap ditutup.
pub const CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; \
style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; \
media-src data: blob: https:; connect-src https:; form-action 'none'; base-uri 'none'";

#[derive(Default)]
pub struct ArtifactStore {
    inner: Mutex<Pages>,
}

#[derive(Default)]
struct Pages {
    next: u64,
    pages: VecDeque<(String, Vec<u8>)>,
}

impl ArtifactStore {
    /// Menyimpan halaman dan mengembalikan ID-nya untuk dipakai sebagai path URL.
    pub fn put(&self, html: String) -> Result<String, String> {
        if html.len() > MAX_BYTES {
            return Err("pratinjau terlalu besar".into());
        }
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "penyimpanan pratinjau tidak tersedia".to_string())?;
        inner.next += 1;
        let id = format!("a{}", inner.next);
        inner.pages.push_back((id.clone(), html.into_bytes()));
        while inner.pages.len() > MAX_PAGES {
            inner.pages.pop_front();
        }
        Ok(id)
    }

    /// Jawaban protocol untuk path `/<id>`.
    pub fn respond(&self, path: &str) -> Response<Vec<u8>> {
        let id = path.trim_start_matches('/');
        let body = self.inner.lock().ok().and_then(|inner| {
            inner
                .pages
                .iter()
                .find(|(key, _)| key == id)
                .map(|(_, html)| html.clone())
        });
        let builder = Response::builder()
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::REFERRER_POLICY, "no-referrer");
        let response = match body {
            Some(html) => builder
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .header(header::CONTENT_SECURITY_POLICY, CSP)
                .body(html),
            None => builder
                .status(StatusCode::NOT_FOUND)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(b"pratinjau tidak ditemukan".to_vec()),
        };
        response.unwrap_or_else(|_| Response::new(Vec::new()))
    }
}

#[tauri::command]
pub fn artifact_put(
    store: tauri::State<'_, ArtifactStore>,
    html: String,
) -> Result<String, String> {
    store.put(html)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halaman_disajikan_dengan_csp_dan_tipe_html() {
        let store = ArtifactStore::default();
        let id = store.put("<p>halo</p>".into()).unwrap();
        let res = store.respond(&format!("/{id}"));
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.body(), b"<p>halo</p>");
        assert_eq!(res.headers()[header::CONTENT_SECURITY_POLICY], CSP);
        assert!(res.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/html"));
    }

    #[test]
    fn id_tidak_dikenal_404_dan_halaman_tertua_dibuang() {
        let store = ArtifactStore::default();
        assert_eq!(store.respond("/a999").status(), StatusCode::NOT_FOUND);
        let first = store.put("1".into()).unwrap();
        for _ in 0..MAX_PAGES {
            store.put("x".into()).unwrap();
        }
        assert_eq!(
            store.respond(&format!("/{first}")).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn halaman_terlalu_besar_ditolak() {
        let store = ArtifactStore::default();
        assert!(store.put("x".repeat(MAX_BYTES + 1)).is_err());
    }
}
