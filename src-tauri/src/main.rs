// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() {
  if app_lib::is_browser_helper_launch() {
    app_lib::run_browser_helper();
    return;
  }
  app_lib::run();
}
