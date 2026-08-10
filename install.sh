#!/usr/bin/env sh
# Keelson —— macOS / Linux 一键安装脚本
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/akapril/keelson/master/install.sh | sh
#
# 作用：从 GitHub Releases 取最新已发布版本，按系统/架构下载对应安装包并安装：
#   - macOS：下载 .dmg（自动匹配 arm64 / x64）→ 拷入 /Applications → 去隔离属性。
#   - Linux：优先 .AppImage（放入 ~/.local/bin），无则 .deb（sudo dpkg -i）。
#
# 说明：macOS 应用为 ad-hoc 签名、未做 Apple 公证；本脚本已自动移除 quarantine 属性，
#       否则首次打开会被 Gatekeeper 拦为“已损坏”。

set -eu
REPO="akapril/keelson"
API="https://api.github.com/repos/${REPO}/releases/latest"

OS="$(uname -s)"
ARCH="$(uname -m)"

echo "→ 查询 Keelson 最新版本..."
JSON="$(curl -fsSL "$API")"
VER="$(printf '%s' "$JSON" | grep -o '"tag_name"[^,]*' | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')"

# 按正则从 assets 里挑一个下载直链。$1 = 匹配 asset 名的 grep -E 正则
pick() {
  printf '%s' "$JSON" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | sed 's/.*"\(https[^"]*\)".*/\1/' \
    | grep -iE "$1" \
    | head -1
}

case "$OS" in
  Darwin)
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
      URL="$(pick 'aarch64.*\.dmg$|arm64.*\.dmg$')"
    else
      URL="$(pick 'x64.*\.dmg$|x86_64.*\.dmg$')"
    fi
    [ -n "${URL:-}" ] || { echo "✗ 未找到 macOS(.dmg) 安装包，请到 https://github.com/${REPO}/releases 手动下载"; exit 1; }

    TMP="$(mktemp -d)"
    DMG="${TMP}/Keelson.dmg"
    echo "→ 下载 ${VER}: ${URL##*/}"
    curl -fsSL "$URL" -o "$DMG"

    MNT="${TMP}/mnt"; mkdir -p "$MNT"
    hdiutil attach "$DMG" -mountpoint "$MNT" -nobrowse -quiet
    APP="$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)"
    NAME="$(basename "$APP")"
    echo "→ 安装到 /Applications/${NAME}"
    rm -rf "/Applications/${NAME}"
    cp -R "$APP" /Applications/
    hdiutil detach "$MNT" -quiet || true
    # 去掉隔离属性（ad-hoc 签名未公证；否则 Gatekeeper 报“已损坏”）
    xattr -dr com.apple.quarantine "/Applications/${NAME}" 2>/dev/null || true
    echo "✓ 完成：/Applications/${NAME}（首次可能仍需在 系统设置→隐私与安全性 点“仍要打开”）"
    ;;

  Linux)
    URL="$(pick 'amd64.*\.AppImage$|x86_64.*\.AppImage$|\.AppImage$')"
    if [ -n "${URL:-}" ]; then
      DEST="${HOME}/.local/bin"; mkdir -p "$DEST"
      OUT="${DEST}/Keelson.AppImage"
      echo "→ 下载 AppImage ${VER}: ${URL##*/}"
      curl -fsSL "$URL" -o "$OUT"
      chmod +x "$OUT"
      echo "✓ 完成：${OUT}"
      case ":${PATH}:" in
        *":${DEST}:"*) echo "  直接运行： Keelson.AppImage" ;;
        *) echo "  提示：${DEST} 不在 PATH，可运行： ${OUT}" ;;
      esac
    else
      URL="$(pick '\.deb$')"
      [ -n "${URL:-}" ] || { echo "✗ 未找到 Linux 安装包，请到 https://github.com/${REPO}/releases 手动下载"; exit 1; }
      TMP="$(mktemp -d)"; DEB="${TMP}/keelson.deb"
      echo "→ 下载 .deb ${VER}: ${URL##*/}"
      curl -fsSL "$URL" -o "$DEB"
      echo "→ 安装（需要 sudo）..."
      sudo dpkg -i "$DEB" || sudo apt-get -f install -y
      echo "✓ 完成。"
    fi
    ;;

  *)
    echo "✗ 不支持的系统：${OS}。Windows 请用 PowerShell： irm https://raw.githubusercontent.com/${REPO}/master/install.ps1 | iex"
    exit 1
    ;;
esac
