#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.dat"))
}

/// The Supabase session is encrypted to this Windows user with DPAPI, as TimeBlock did.
#[cfg(windows)]
mod dpapi {
    use std::{ptr, slice};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB},
    };

    fn run(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        let source = CRYPT_INTEGER_BLOB { cbData: input.len() as u32, pbData: input.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        let ok = unsafe {
            if protect {
                CryptProtectData(&source, ptr::null(), ptr::null(), ptr::null(), ptr::null(), 0, &mut out)
            } else {
                CryptUnprotectData(&source, ptr::null_mut(), ptr::null(), ptr::null(), ptr::null(), 0, &mut out)
            }
        };
        if ok == 0 {
            return Err("Windows could not read the saved session".into());
        }
        let bytes = unsafe { slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as _) };
        Ok(bytes)
    }

    pub fn protect(input: &[u8]) -> Result<Vec<u8>, String> { run(input, true) }
    pub fn unprotect(input: &[u8]) -> Result<Vec<u8>, String> { run(input, false) }
}

#[cfg(not(windows))]
mod dpapi {
    // shortcut: plain file off Windows, add a keychain if RECALL ever ships on another OS.
    pub fn protect(input: &[u8]) -> Result<Vec<u8>, String> { Ok(input.to_vec()) }
    pub fn unprotect(input: &[u8]) -> Result<Vec<u8>, String> { Ok(input.to_vec()) }
}

#[tauri::command]
fn secret_get(app: AppHandle) -> Result<Option<String>, String> {
    let path = session_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    // An unreadable file (another Windows user, a moved profile) means signing in again, not a crash.
    Ok(dpapi::unprotect(&raw).ok().and_then(|b| String::from_utf8(b).ok()))
}

#[tauri::command]
fn secret_set(app: AppHandle, value: Option<String>) -> Result<(), String> {
    let path = session_path(&app)?;
    match value {
        Some(v) => fs::write(path, dpapi::protect(v.as_bytes())?).map_err(|e| e.to_string()),
        None => {
            let _ = fs::remove_file(path);
            Ok(())
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set])
        .run(tauri::generate_context!())
        .expect("RECALL failed to start");
}
