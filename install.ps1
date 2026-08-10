# Keelson —— Windows 一键安装脚本
#
# 用法（PowerShell）：
#   irm https://raw.githubusercontent.com/akapril/keelson/master/install.ps1 | iex
#
# 作用：从 GitHub Releases 取最新已发布版本，下载 Windows 安装包（优先 NSIS -setup.exe，
#       退而求其次 .msi）并启动安装程序。仅支持 x64。
#
# 说明：应用当前未做代码签名，SmartScreen 可能提示“未知发布者”——点“更多信息 → 仍要运行”。

$ErrorActionPreference = "Stop"
$Repo = "akapril/keelson"

Write-Host "→ 查询 Keelson 最新版本..." -ForegroundColor Cyan
$headers = @{ "User-Agent" = "keelson-install" }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
$version = $release.tag_name

# 优先 NSIS 安装器(-setup.exe)，其次 MSI
$asset = $release.assets | Where-Object { $_.name -match '-setup\.exe$' } | Select-Object -First 1
if (-not $asset) {
  $asset = $release.assets | Where-Object { $_.name -match '\.msi$' } | Select-Object -First 1
}
if (-not $asset) {
  throw "未在最新 Release ($version) 中找到 Windows 安装包（-setup.exe / .msi）。请到 https://github.com/$Repo/releases 手动下载。"
}

$out = Join-Path $env:TEMP $asset.name
Write-Host "→ 下载 $($asset.name)  ($version)" -ForegroundColor Cyan
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -Headers $headers

Write-Host "→ 启动安装程序..." -ForegroundColor Cyan
Start-Process -FilePath $out -Wait

Write-Host "✓ 安装完成。可在开始菜单搜索 Keelson 启动。" -ForegroundColor Green
