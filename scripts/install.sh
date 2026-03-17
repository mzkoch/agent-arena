#!/usr/bin/env bash
set -euo pipefail

REPO="${ARENA_REPO:-agent-arena/agent-arena}"
VERSION="${ARENA_VERSION:-latest}"
INSTALL_DIR="${ARENA_INSTALL_DIR:-/usr/local/bin}"

detect_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "darwin" ;;
    *) echo "Unsupported OS" >&2; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "Unsupported architecture" >&2; exit 1 ;;
  esac
}

OS="$(detect_os)"
ARCH="$(detect_arch)"
ASSET="arena-${OS}-${ARCH}.tar.gz"
BASE_URL="https://github.com/${REPO}/releases"

if [[ "${VERSION}" == "latest" ]]; then
  URL="${BASE_URL}/latest/download/${ASSET}"
else
  URL="${BASE_URL}/download/${VERSION}/${ASSET}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

curl -fsSL "${URL}" -o "${TMP_DIR}/${ASSET}"
tar -xzf "${TMP_DIR}/${ASSET}" -C "${TMP_DIR}"
install -m 0755 "${TMP_DIR}/arena" "${INSTALL_DIR}/arena"

echo "Installed arena to ${INSTALL_DIR}/arena"
