; Keelson 自定义 NSIS 安装器钩子。
; 目的：卸载时清理「开机自启」注册表项——tauri-plugin-autostart 在运行时写入
; HKCU\Software\Microsoft\Windows\CurrentVersion\Run 的 "Keelson" 值，NSIS 默认不清理它，
; 卸载后会残留一条指向已删除 exe 的孤儿自启项，开机时 Windows 会徒劳地尝试拉起。
; 这里在卸载后主动删除该值（值名与 productName 一致 = "Keelson"）。

!macro NSIS_HOOK_POSTUNINSTALL
  ; 当前用户级自启项（插件默认写 HKCU）
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Keelson"
!macroend
