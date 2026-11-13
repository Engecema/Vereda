#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Projeto Vereda — Instalador Vereda (SQLite3) para VPS Ubuntu / Debian
# Engecema Infraestrutura
# ==============================================================================

VEREDA_VERSION="${VEREDA_VERSION:-0.23.0}"
VEREDA_DOMAIN="${VEREDA_DOMAIN:-engecema.com.br}"
VEREDA_BASE_DOMAIN="${VEREDA_BASE_DOMAIN:-engecema.internal}"
VEREDA_USER="${VEREDA_USER:-engecema}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[ERRO] Execute este script como root (ex.: sudo bash scripts/instalar_vereda_vps.sh)." >&2
  exit 1
fi

if [[ ! "${VEREDA_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[ERRO] VEREDA_VERSION invalida: ${VEREDA_VERSION}" >&2
  exit 1
fi

if [[ ! "${VEREDA_DOMAIN}" =~ ^[a-zA-Z0-9.-]+$ ]]; then
  echo "[ERRO] VEREDA_DOMAIN invalido: ${VEREDA_DOMAIN}" >&2
  exit 1
fi

if [[ ! "${VEREDA_BASE_DOMAIN}" =~ ^[a-zA-Z0-9.-]+$ ]]; then
  echo "[ERRO] VEREDA_BASE_DOMAIN invalido: ${VEREDA_BASE_DOMAIN}" >&2
  exit 1
fi

if [[ ! "${VEREDA_USER}" =~ ^[a-z0-9_-]{2,32}$ ]]; then
  echo "[ERRO] VEREDA_USER invalido: ${VEREDA_USER}" >&2
  exit 1
fi

if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    echo "[ERRO] Sistema operacional nao suportado (${ID:-desconhecido}). Utilize Ubuntu ou Debian." >&2
    exit 1
  fi
else
  echo "[ERRO] Arquivo /etc/os-release nao encontrado." >&2
  exit 1
fi

UNAME_ARCH="$(uname -m)"
case "${UNAME_ARCH}" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  *)
    echo "[ERRO] Arquitetura nao suportada: ${UNAME_ARCH}" >&2
    exit 1
    ;;
esac

umask 077
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "[1/6] Atualizando pacotes base (curl, sqlite3, ca-certificates)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates sqlite3

DEB_FILE="vereda_${VEREDA_VERSION}_linux_${ARCH}.deb"
BASE_URL="https://github.com/Engecema/Vereda/releases/download/v${VEREDA_VERSION}"

echo "[2/6] Baixando Vereda v${VEREDA_VERSION} (${ARCH}) e verificando SHA-256..."
curl -fsSL --proto '=https' --tlsv1.2 "${BASE_URL}/${DEB_FILE}" -o "${TMP_DIR}/${DEB_FILE}"
curl -fsSL --proto '=https' --tlsv1.2 "${BASE_URL}/checksums.txt" -o "${TMP_DIR}/checksums.txt"

(
  cd "${TMP_DIR}"
  grep -F "${DEB_FILE}" checksums.txt > checksum_target.txt
  if [[ ! -s checksum_target.txt ]]; then
    echo "[ERRO] Hash SHA-256 nao encontrado para ${DEB_FILE}." >&2
    exit 1
  fi
  sha256sum -c checksum_target.txt
)

echo "[3/6] Instalando pacote Vereda..."
dpkg -i "${TMP_DIR}/${DEB_FILE}"

echo "[4/6] Preparando diretorios e permissoes seguras..."
id -u vereda >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin vereda
install -d -m 0750 -o vereda -g vereda /etc/vereda
install -d -m 0700 -o vereda -g vereda /var/lib/vereda

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_CONFIG_EXAMPLE="${SCRIPT_DIR}/../config/config.yaml.example"

echo "[5/6] Aplicando configuracao /etc/vereda/config.yaml (SQLite3)..."
if [[ -f /etc/vereda/config.yaml ]]; then
  cp /etc/vereda/config.yaml "/etc/vereda/config.yaml.bak.$(date +%Y%m%d%H%M%S)"
fi

if [[ -f "${REPO_CONFIG_EXAMPLE}" ]]; then
  cp "${REPO_CONFIG_EXAMPLE}" /etc/vereda/config.yaml
  sed -i "s|^server_url:.*|server_url: https://${VEREDA_DOMAIN}|" /etc/vereda/config.yaml
  sed -i "s|base_domain:.*|base_domain: ${VEREDA_BASE_DOMAIN}|" /etc/vereda/config.yaml
else
  cat > /etc/vereda/config.yaml <<EOF
server_url: https://${VEREDA_DOMAIN}
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 127.0.0.1:9090

private_key_path: /var/lib/vereda/private.key
noise:
  private_key_path: /var/lib/vereda/noise_private.key

prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48

derp:
  server:
    enabled: false
  urls:
    - https://${VEREDA_DOMAIN}/derpmap/default
  auto_update_enabled: true
  update_frequency: 24h

database:
  type: sqlite
  sqlite:
    path: /var/lib/vereda/db.sqlite

dns:
  magic_dns: true
  base_domain: ${VEREDA_BASE_DOMAIN}
  nameservers:
    global:
      - 1.1.1.1
      - 9.9.9.9
EOF
fi

chown vereda:vereda /etc/vereda/config.yaml
chmod 0600 /etc/vereda/config.yaml

if command -v ufw >/dev/null 2>&1; then
  echo "[INFO] Configurando regras basicas de firewall UFW (HTTPS 443 + WireGuard/DERP 41641/udp)..."
  ufw allow 443/tcp comment "Vereda HTTPS Reverse Proxy" >/dev/null || true
  ufw allow 41641/udp comment "Vereda WireGuard Mesh" >/dev/null || true
fi

echo "[6/6] Iniciando servico systemd vereda..."
systemctl daemon-reload
systemctl enable vereda
systemctl restart vereda

sleep 2
if ! systemctl is-active --quiet vereda; then
  echo "[ERRO] Servico vereda nao iniciou corretamente. Verifique: journalctl -u vereda -n 50" >&2
  exit 1
fi

vereda users create "${VEREDA_USER}" >/dev/null 2>&1 || true

echo ""
echo "========================================================================"
echo " Vereda instalado e ativo!"
echo " Dominio: https://${VEREDA_DOMAIN}"
echo " Banco SQLite3: /var/lib/vereda/db.sqlite"
echo " Usuario/Namespace inicial: ${VEREDA_USER}"
echo "------------------------------------------------------------------------"
echo " Proximos passos recomendados:"
echo " 1. Configure proxy reverso TLS (Nginx/Caddy) encaminhando 443 -> 127.0.0.1:8080"
echo " 2. Gere uma Pre-Auth Key:"
echo "    vereda preauthkeys create --user ${VEREDA_USER} --reusable --expiration 24h"
echo " 3. Liste nos conectados:"
echo "    vereda nodes list"
echo "========================================================================"
