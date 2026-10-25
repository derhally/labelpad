// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--mcp") {
        std::process::exit(labelpad_lib::run_mcp_stdio());
    }
    labelpad_lib::run()
}
