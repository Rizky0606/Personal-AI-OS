// Tanpa jendela konsol di build release Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aios_desktop_lib::run()
}
