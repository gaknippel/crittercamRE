// Finds the running re4.exe or re2.exe, installs lua/recam.lua into its reframework/autorun folder, and passes json files with it
// through reframework/data (the only folder REFramework's json.* functions can touch).
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

const GAME_EXES: [&str; 2] = ["re4.exe", "re2.exe"];

fn is_game(name: &str) -> bool {
    GAME_EXES.iter().any(|g| name.eq_ignore_ascii_case(g))
}
const SCRIPT: &str = include_str!("../../lua/recam.lua");

fn utf16(chars: &[u16]) -> String {
    let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
    String::from_utf16_lossy(&chars[..end])
}

/// The folder the game runs from, if one is running.
fn game_dir() -> Option<PathBuf> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut pid = None;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            if is_game(&utf16(&entry.szExeFile)) {
                pid = Some(entry.th32ProcessID);
                break;
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        exe_path(pid?)?.parent().map(PathBuf::from)
    }
}

fn exe_path(pid: u32) -> Option<PathBuf> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(process);
        ok.then(|| PathBuf::from(utf16(&buf[..len as usize])))
    }
}

/// The game's devices keep reporting keys while it's in the background, and the script can't see window focus.
/// So this thread tells it: reframework/data/recam_focus.json, on every change and as a heartbeat (stale = the app
/// is closed, and the script then assumes focus).
fn watch_focus() {
    let mut dir: Option<PathBuf> = None;
    let mut last: Option<bool> = None;
    for i in 0u64.. {
        let heartbeat = i % 10 == 0; // every 500 ms
        let fg = unsafe {
            let mut pid = 0;
            GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
            exe_path(pid)
        };
        let focused = fg.as_ref().is_some_and(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(is_game));
        if focused {
            dir = fg.and_then(|p| p.parent().map(PathBuf::from));
        } else if heartbeat {
            dir = game_dir(); // not running any more, or not found yet
        }
        if let Some(d) = &dir
            && (last != Some(focused) || heartbeat)
        {
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let data = d.join("reframework/data");
            let tmp = data.join("recam_focus.json.tmp");
            let ok = fs::create_dir_all(&data)
                .and_then(|_| fs::write(&tmp, format!("{{\"focused\":{focused},\"at\":{secs}}}")))
                .and_then(|_| fs::rename(&tmp, data.join("recam_focus.json")))
                .is_ok();
            if ok {
                last = Some(focused);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

fn reframework() -> Result<PathBuf, String> {
    Ok(game_dir().ok_or("resident evil 2 or 4 isn't running.")?.join("reframework"))
}

#[derive(Serialize)]
struct Status {
    game_running: bool,
    script_installed: bool,
    script_current: bool,
    script_version: &'static str,
    state: Option<String>,
}

/// `local VERSION = "x"` from the bundled script, so the app can tell when the game still runs an older one.
fn script_version() -> &'static str {
    SCRIPT.split("local VERSION = \"").nth(1).and_then(|s| s.split('"').next()).unwrap_or("")
}

#[tauri::command]
fn status() -> Status {
    let Ok(rf) = reframework() else {
        return Status { game_running: false, script_installed: false, script_current: false, script_version: script_version(), state: None };
    };
    let installed = fs::read_to_string(rf.join("autorun/recam.lua")).ok();
    Status {
        game_running: true,
        script_installed: installed.is_some(),
        // compare without line endings, git may have changed them
        script_current: installed.is_some_and(|s| s.replace('\r', "") == SCRIPT.replace('\r', "")),
        script_version: script_version(),
        state: fs::read_to_string(rf.join("data/recam_state.json")).ok(),
    }
}

#[tauri::command]
fn install_script() -> Result<(), String> {
    let rf = reframework()?;
    if !rf.exists() {
        return Err("reframework isn't installed for this game (no reframework folder next to re4.exe).".into());
    }
    let autorun = rf.join("autorun");
    let _ = fs::remove_file(autorun.join("re4cam.lua")); // the old name: two copies would both hook the game
    fs::create_dir_all(&autorun).and_then(|_| fs::write(autorun.join("recam.lua"), SCRIPT)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_cmd(json: String) -> Result<(), String> {
    let data = reframework()?.join("data");
    let tmp = data.join("recam_cmd.json.tmp");
    // write + rename so the game never reads a half written file
    fs::create_dir_all(&data)
        .and_then(|_| fs::write(&tmp, json))
        .and_then(|_| fs::rename(&tmp, data.join("recam_cmd.json")))
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build()) // remembers the window size and position between launches
        .setup(|_| {
            std::thread::spawn(watch_focus);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![status, install_script, write_cmd])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
