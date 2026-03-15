#!/usr/bin/env bash

set -euo pipefail

REPO="VGLoic/ethoko"
INSTALL_DIR="${ETHOKO_INSTALL_DIR:-$HOME/.ethoko}"
BIN_DIR="$INSTALL_DIR/bin"

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)
      os="linux"
      ;;
    Darwin*)
      os="darwin"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      os="windows"
      ;;
    *)
      echo "Error: Unsupported OS $(uname -s)"
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)
      arch="x64"
      ;;
    aarch64|arm64)
      arch="arm64"
      ;;
    *)
      echo "Error: Unsupported architecture $(uname -m)"
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

get_latest_version() {
  curl -s "https://api.github.com/repos/$REPO/releases" \
    | grep '"tag_name"' \
    | grep 'cli-v' \
    | head -n 1 \
    | sed -E 's/.*"cli-v([^"]+)".*/\1/'
}

ensure_path() {
  local path_line="export PATH=\"${BIN_DIR}:\$PATH\""
  for profile in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$profile" ]; then
      if ! grep -q "$BIN_DIR" "$profile"; then
        echo "$path_line" >> "$profile"
      fi
    else
      echo "$path_line" >> "$profile"
    fi
  done
}

main() {
  echo "🔍 Detecting platform..."
  local platform
  platform=$(detect_platform)
  echo "✓ Platform: $platform"

  echo "🔍 Finding latest version..."
  local version
  version=$(get_latest_version)
  if [ -z "$version" ]; then
    echo "Error: Could not determine latest version"
    exit 1
  fi
  echo "✓ Latest version: $version"

  local binary_name="ethoko-${platform}"
  local ext=""
  if [[ "$platform" == windows* ]]; then
    ext=".exe"
  fi

  local download_url="https://github.com/$REPO/releases/download/cli-v$version/$binary_name$ext"

  mkdir -p "$BIN_DIR"
  local tmp_file
  tmp_file=$(mktemp)

  echo "⬇️  Downloading $download_url"
  curl -L "$download_url" -o "$tmp_file"

  local target_name="ethoko"
  if [[ "$platform" == windows* ]]; then
    target_name="ethoko.exe"
  fi

  mv "$tmp_file" "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"

  ensure_path

  echo "✅ Ethoko installed to $BIN_DIR/$target_name"
  echo "➡️  Restart your shell or run: export PATH=\"${BIN_DIR}:\$PATH\""
  "$BIN_DIR/$target_name" --version || true
}

main
