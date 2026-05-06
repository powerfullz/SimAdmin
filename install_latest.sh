#!/bin/sh

set -eu

REPO="${REPO:-3899/SimAdmin}"
INSTALL_DIR="${INSTALL_DIR:-/opt/simadmin}"
SERVICE_NAME="${SERVICE_NAME:-simadmin}"
VERSION="${VERSION:-latest}"
GH_PROXY="${GH_PROXY:-https://gh-proxy.com/}"
GH_PROXY_FALLBACKS="${GH_PROXY_FALLBACKS:-https://ghproxy.net/ https://githubproxy.cc/}"
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/${REPO}}"
SERVICE_URL="${SERVICE_URL:-${RAW_BASE}/main/scripts/simadmin.service}"
MODEM_RECOVERY_SCRIPT_URL="${MODEM_RECOVERY_SCRIPT_URL:-${RAW_BASE}/main/scripts/simadmin-modem-recovery.sh}"
MODEM_RECOVERY_SERVICE_URL="${MODEM_RECOVERY_SERVICE_URL:-${RAW_BASE}/main/scripts/simadmin-modem-recovery.service}"
ASSET_URL="${ASSET_URL:-}"
ASSET_NAME="${ASSET_NAME:-simadmin_latest.tar.gz}"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "error: please run as root" >&2
    exit 1
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required command: $1" >&2
    exit 1
  fi
}

download_with_proxies() {
  src_url="$1"
  dst_path="$2"

  case "$src_url" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://objects.githubusercontent.com/*)
      for proxy in $GH_PROXY $GH_PROXY_FALLBACKS ""; do
        url="${proxy}${src_url}"
        echo "    ${url}"
        if curl -fsSL "$url" -o "$dst_path"; then
          return 0
        fi
        echo "    download failed, trying next mirror" >&2
      done
      ;;
    *)
      echo "    ${src_url}"
      curl -fsSL "$src_url" -o "$dst_path"
      return $?
      ;;
  esac

  return 1
}

read_with_proxies() {
  src_url="$1"

  case "$src_url" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://objects.githubusercontent.com/*)
      for proxy in $GH_PROXY $GH_PROXY_FALLBACKS ""; do
        url="${proxy}${src_url}"
        echo "    ${url}" >&2
        if curl -fsSL "$url"; then
          return 0
        fi
        echo "    download failed, trying next mirror" >&2
      done
      ;;
    *)
      echo "    ${src_url}" >&2
      curl -fsSL "$src_url"
      return $?
      ;;
  esac

  return 1
}

version_to_tag() {
  case "$1" in
    v*) printf '%s\n' "$1" ;;
    *) printf 'v%s\n' "$1" ;;
  esac
}

asset_url_from_tag() {
  tag="$1"
  asset_version="${tag#v}"
  printf 'https://github.com/%s/releases/download/%s/simadmin_%s.tar.gz\n' "$REPO" "$tag" "$asset_version"
}

repo_version() {
  version_text="$(read_with_proxies "${RAW_BASE}/main/VERSION" | tr -d '[:space:]')"
  if [ -z "$version_text" ]; then
    return 1
  fi
  printf '%s\n' "$version_text"
}

resolve_asset_url() {
  if [ -n "$ASSET_URL" ]; then
    printf '%s\n' "$ASSET_URL"
    return 0
  fi

  if [ "$VERSION" = "latest" ]; then
    printf 'https://github.com/%s/releases/latest/download/%s\n' "$REPO" "$ASSET_NAME"
  else
    asset_url_from_tag "$(version_to_tag "$VERSION")"
  fi
}

fallback_asset_url() {
  if [ "$VERSION" = "latest" ] && [ -z "$ASSET_URL" ]; then
    if version_text="$(repo_version)"; then
      asset_url_from_tag "$(version_to_tag "$version_text")"
      return 0
    fi
  fi

  return 1
}

download_release_asset() {
  archive_path="$1"
  primary_url="$2"
  fallback_url=""

  echo "==> downloading release asset"
  if download_with_proxies "$primary_url" "$archive_path"; then
    return 0
  fi

  if fallback_url="$(fallback_asset_url)" && [ "$fallback_url" != "$primary_url" ]; then
    echo "==> latest asset alias download failed, trying versioned asset"
    if download_with_proxies "$fallback_url" "$archive_path"; then
      return 0
    fi
  fi

  echo "error: failed to download OTA asset" >&2
  echo "       tried: $primary_url" >&2
  if [ -n "$fallback_url" ]; then
    echo "       tried: $fallback_url" >&2
  fi
  exit 1
}

install_service_file() {
  service_dst="/etc/systemd/system/${SERVICE_NAME}.service"
  mkdir -p /etc/systemd/system
  download_with_proxies "$SERVICE_URL" "$service_dst"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}.service" >/dev/null
}

install_modem_recovery_service() {
  script_dst="/usr/local/bin/simadmin-modem-recovery.sh"
  service_dst="/etc/systemd/system/simadmin-modem-recovery.service"

  mkdir -p /usr/local/bin /etc/systemd/system
  download_with_proxies "$MODEM_RECOVERY_SCRIPT_URL" "$script_dst"
  chmod 0755 "$script_dst"
  download_with_proxies "$MODEM_RECOVERY_SERVICE_URL" "$service_dst"
  systemctl daemon-reload
  systemctl enable simadmin-modem-recovery.service >/dev/null
}

configure_networkmanager_modem_unmanaged() {
  if [ ! -d /etc/NetworkManager ]; then
    return 0
  fi

  echo "==> configuring NetworkManager to ignore wwan modem"
  mkdir -p /etc/NetworkManager/conf.d
  nm_conf="/etc/NetworkManager/conf.d/99-simadmin-unmanaged-modem.conf"
  {
    printf '%s\n' '[keyfile]'
    printf '%s\n' 'unmanaged-devices=interface-name:wwan*'
  } > "$nm_conf"

  if systemctl is-active --quiet NetworkManager.service; then
    systemctl restart NetworkManager.service || true
  fi
}

main() {
  require_root
  require_cmd curl
  require_cmd systemctl
  require_cmd mktemp

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT INT TERM

  asset_url="$(resolve_asset_url)"

  case "$asset_url" in
    *.tar.gz)
      require_cmd tar
      archive_path="${tmp_dir}/simadmin.tar.gz"
      ;;
    *)
      echo "error: unsupported OTA asset format, expected .tar.gz: $asset_url" >&2
      exit 1
      ;;
  esac

  download_release_asset "$archive_path" "$asset_url"

  echo "==> extracting package"
  mkdir -p "${tmp_dir}/pkg"
  tar -xzf "$archive_path" -C "${tmp_dir}/pkg"

  if [ ! -f "${tmp_dir}/pkg/simadmin" ]; then
    echo "error: invalid package, missing simadmin binary" >&2
    exit 1
  fi

  if [ ! -d "${tmp_dir}/pkg/www" ]; then
    echo "error: invalid package, missing frontend www directory" >&2
    exit 1
  fi

  echo "==> stopping existing service"
  systemctl stop "${SERVICE_NAME}.service" >/dev/null 2>&1 || true

  echo "==> installing files to ${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
  install -m 0755 "${tmp_dir}/pkg/simadmin" "${INSTALL_DIR}/simadmin"
  rm -rf "${INSTALL_DIR}/www"
  cp -R "${tmp_dir}/pkg/www" "${INSTALL_DIR}/www"
  chmod -R a+rX "${INSTALL_DIR}/www"

  if [ -f "${tmp_dir}/pkg/meta.json" ]; then
    install -m 0644 "${tmp_dir}/pkg/meta.json" "${INSTALL_DIR}/meta.json"
  fi

  echo "==> installing systemd unit"
  install_service_file
  echo "==> installing modem recovery service"
  install_modem_recovery_service
  configure_networkmanager_modem_unmanaged

  echo "==> starting service"
  systemctl restart "${SERVICE_NAME}.service"

  echo "==> done"
  echo "    service: ${SERVICE_NAME}.service"
  echo "    modem recovery: simadmin-modem-recovery.service"
  echo "    install dir: ${INSTALL_DIR}"
  systemctl status "${SERVICE_NAME}.service" --no-pager
}

main "$@"
