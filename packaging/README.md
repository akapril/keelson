# 包管理器发布（packaging）

各平台"一行命令安装"需要把清单发布到对应生态。本目录放好可发布的清单/CI 骨架；
外部仓库/密钥那一步需人工完成一次。

| 平台 | 目标命令 | 现状 | 一次性步骤 |
|---|---|---|---|
| Windows · winget | `winget install akapril.Keelson` | ✅ 有 CI（`.github/workflows/winget.yml`） | ①本机 `wingetcreate new <某 -setup.exe 直链>` 提首个清单；②仓库加 secret `WINGET_TOKEN`（勾 public_repo 的 PAT）。之后每次正式发布自动更新。 |
| Windows · scoop | `scoop bucket add keelson <bucket仓库> && scoop install keelson` | ⚠ 骨架（`packaging/scoop/keelson.json`） | 建个 scoop bucket 仓库（用官方 BucketTemplate），把 `keelson.json` 放进 `bucket/`；首个 `hash` 需实测填（下载 setup.exe 后 `Get-FileHash`）。NSIS 经 `#/dl.7z` 解包为便携——首次需真机验证能跑出 `Keelson.exe`。 |
| Linux · AUR | `yay -S keelson-bin` | ⚠ 骨架（`packaging/aur/PKGBUILD`） | 发到 AUR：填 `sha256sums`（`updpkgsums`）、`makepkg --printsrcinfo > .SRCINFO`、push 到 `ssh://aur@aur.archlinux.org/keelson-bin.git`。 |
| macOS · brew cask | `brew install --cask keelson` | ⛔ 阻塞 | 需 Apple Developer ID 签名 + **公证**（Homebrew 5.0 起强制，未公证 cask 2026-09 前移除）+ 知名度（≥ 30 forks/30 watchers/75 stars 之一）。先做公证再议。 |

在此之前，**立即可用**的是仓库根的一键脚本 `install.ps1` / `install.sh`（直接从 GitHub Releases 装），以及 Releases 页手动下载。

> 提示：若嫌逐个维护麻烦，[GoReleaser](https://goreleaser.com/) 可从 GitHub Releases 一次性生成并发布 winget / scoop / Homebrew / AUR 清单。
