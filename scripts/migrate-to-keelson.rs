//! migrate-to-keelson.rs —— 一次性数据迁移工具（独立程序，不依赖主程序 / 无外部 crate）。
//!
//! 背景：Keelson 把应用标识符由 `com.rework.app` 改为 `com.keelson.app`。旧版本的数据分散在
//! 两个目录：`<data>/com.rework.app`（pb_data、密钥、mcp-endpoint 等）与 `<data>/rework`
//! （config.toml、web_devices.json）。本工具把二者**合并搬进**新目录 `<data>/com.keelson.app`。
//! 身份保持冻结（PB 用户邮箱 / keyring 服务名未改）→ 纯搬文件，pb_data 用户与密钥原样有效。
//!
//! 用法：
//!   rustc -O migrate-to-keelson.rs -o migrate-to-keelson.exe   # 编译
//!   ./migrate-to-keelson.exe                                    # 运行（Windows 双击亦可）
//!   ./migrate-to-keelson.exe --dry-run                          # 只预览、不动数据
//!
//! ⚠️ 运行前请**完全关闭 Keelson/应用**（避免 PocketBase 占用 pb_data 导致搬运失败）。
//! ⚠️ 请在**首次启动 keelson 新版之前**运行；若已启动过新版并生成了空的
//!    `com.keelson.app/pb_data`，本工具会中止并提示你先删掉那个空目录再重跑。

use std::path::{Path, PathBuf};

const NEW_DIR: &str = "com.keelson.app";
/// 旧目录（都要合并搬进新目录）：旧 identifier 夹 + 旧 AppPaths 字面夹。
const OLD_DIRS: &[&str] = &["com.rework.app", "rework"];

/// 跨平台数据根目录（等价 dirs::data_dir()，但不引入外部 crate）。
/// Windows=%APPDATA%(Roaming)；macOS=~/Library/Application Support；Linux=$XDG_DATA_HOME 或 ~/.local/share。
fn data_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
    }
}

/// 搬一个文件/目录：先试原子 rename（同盘）；跨盘失败则递归 copy 后删源。
fn move_entry(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_recursive(from, to)?;
    if from.is_dir() {
        let _ = std::fs::remove_dir_all(from);
    } else {
        let _ = std::fs::remove_file(from);
    }
    Ok(())
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for e in std::fs::read_dir(from)?.flatten() {
            copy_recursive(&e.path(), &to.join(e.file_name()))?;
        }
    } else {
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(from, to)?;
    }
    Ok(())
}

/// 把 src 下所有子项搬到 dst（跳过名为 skip 的子项）；目标已存在的同名项跳过（不覆盖）。
/// dry_run 时只打印不搬。返回处理的子项数。
fn move_dir_children(src: &Path, dst: &Path, skip: Option<&str>, dry_run: bool) -> usize {
    let Ok(entries) = std::fs::read_dir(src) else { return 0 };
    let mut n = 0usize;
    for e in entries.flatten() {
        let name = e.file_name();
        if let Some(s) = skip {
            if name.to_string_lossy() == s {
                continue;
            }
        }
        let to = dst.join(&name);
        if to.exists() {
            println!("   跳过（目标已存在）: {}", name.to_string_lossy());
            continue;
        }
        if dry_run {
            println!("   [dry-run] 将搬运: {}", name.to_string_lossy());
            n += 1;
        } else if move_entry(&e.path(), &to).is_ok() {
            println!("   已搬运: {}", name.to_string_lossy());
            n += 1;
        } else {
            eprintln!("   ⚠️ 搬运失败: {}", name.to_string_lossy());
        }
    }
    n
}

fn main() {
    let dry_run = std::env::args().any(|a| a == "--dry-run");
    let Some(base) = data_root() else {
        eprintln!("❌ 无法定位数据根目录");
        std::process::exit(1);
    };
    let new_root = base.join(NEW_DIR);
    println!("数据根: {}", base.display());
    println!("目标  : {}{}", new_root.display(), if dry_run { "   (dry-run，不动数据)" } else { "" });

    let olds: Vec<PathBuf> = OLD_DIRS
        .iter()
        .map(|d| base.join(d))
        .filter(|p| p.exists() && *p != new_root)
        .collect();
    if olds.is_empty() {
        println!("没有发现旧数据目录（com.rework.app / rework），无需迁移。");
        return;
    }
    for o in &olds {
        println!("发现旧目录: {}", o.display());
    }

    // 安全护栏：新目录已有 pb_data → 可能已迁移，或已启动过新版生成了空数据。中止，不动数据。
    if new_root.join("pb_data").exists() {
        println!();
        println!("⚠️ 新目录已存在 pb_data：{}\\pb_data", new_root.display());
        println!("   若你已经迁移过 → 无需再跑，忽略即可。");
        println!("   若那是启动新版后生成的**空数据** → 请先删除该 pb_data（及新目录里其它空文件）");
        println!("   再重跑本工具。已中止，未做任何改动。");
        std::process::exit(2);
    }

    if !dry_run {
        std::fs::create_dir_all(&new_root).expect("创建新目录失败");
    }
    let mut moved = 0usize;
    // 第一遍：除 pb_data 外全部子项。
    for old in &olds {
        moved += move_dir_children(old, &new_root, Some("pb_data"), dry_run);
    }
    // 第二遍：最后搬 pb_data（作为完成标志）。
    for old in &olds {
        let src = old.join("pb_data");
        if src.exists() && !new_root.join("pb_data").exists() {
            if dry_run {
                println!("   [dry-run] 将搬运: pb_data （{}）", src.display());
                moved += 1;
            } else if move_entry(&src, &new_root.join("pb_data")).is_ok() {
                println!("   已搬运: pb_data");
                moved += 1;
            } else {
                eprintln!("   ⚠️ pb_data 搬运失败（是否有 PocketBase 仍在运行占用？请关闭应用后重试）");
            }
        }
    }

    println!();
    if dry_run {
        println!("✅ dry-run 完成：将搬运 {moved} 个子项 → {}（未做改动）", new_root.display());
    } else {
        println!("✅ 迁移完成：搬运 {moved} 个子项 → {}", new_root.display());
        println!("   确认新版能正常读到数据后，可删除旧目录残壳并卸载旧的 com.rework.app 安装。");
    }
}
