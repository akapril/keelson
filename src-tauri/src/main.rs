// 在 release 构建中阻止额外的控制台窗口出现，请勿删除！！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    keelson_lib::run()
}
