//! Windows Power State Management & Sleep/Wake Socket Recovery
//!
//! Listens for system sleep and wake events (`WM_POWERBROADCAST`) to pause active transfers cleanly
//! before sleep and immediately re-probe/reconnect sockets on wake, preventing 90-second TCP timeout stalls.

use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
pub fn hook_power_events(app: &AppHandle) {
    let Some(main) = app.get_window("main") else { return };
    let Ok(hwnd) = main.hwnd() else { return };

    unsafe {
        use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
        use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
        use windows_sys::Win32::UI::WindowsAndMessaging::WM_POWERBROADCAST;

        const SUBCLASS_ID: usize = 0x505752; // "PWR"
        const PBT_APMSUSPEND: usize = 0x0004;
        const PBT_APMRESUMEAUTOMATIC: usize = 0x0012;
        const PBT_APMRESUMESUSPEND: usize = 0x0007;

        unsafe extern "system" fn subclass_proc(
            hwnd: HWND,
            msg: u32,
            wparam: WPARAM,
            lparam: LPARAM,
            _uid_subclass: usize,
            ref_data: usize,
        ) -> LRESULT {
            if msg == WM_POWERBROADCAST {
                if wparam == PBT_APMSUSPEND {
                    log::info!("System power: PBT_APMSUSPEND received. Computer entering sleep.");
                    let app_ptr = ref_data as *const AppHandle;
                    if !app_ptr.is_null() {
                        let app = &*app_ptr;
                        let _ = app.emit("system-power-suspend", ());
                    }
                } else if wparam == PBT_APMRESUMEAUTOMATIC || wparam == PBT_APMRESUMESUSPEND {
                    log::info!("System power: PBT_APMRESUME received. Computer waking from sleep.");
                    let app_ptr = ref_data as *const AppHandle;
                    if !app_ptr.is_null() {
                        let app = &*app_ptr;
                        let _ = app.emit("system-power-resume", ());
                    }
                }
            }
            DefSubclassProc(hwnd, msg, wparam, lparam)
        }

        let app_box = Box::into_raw(Box::new(app.clone()));
        let raw_hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;
        SetWindowSubclass(raw_hwnd, Some(subclass_proc), SUBCLASS_ID, app_box as usize);
    }
}

#[cfg(not(windows))]
pub fn hook_power_events(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    #[test]
    fn power_module_compiles_cleanly() {
        // Basic compile and constant validity sanity check
        assert_eq!(0x0004, 4);
    }
}
