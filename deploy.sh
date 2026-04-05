#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Configuración inicial + despliegue en servidor Ubuntu/Debian
#
# Uso:
#   Primera vez:   bash deploy.sh setup
#   Actualizar:    bash deploy.sh update
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="https://github.com/cristiantorolopez-coder/Data_Intake_Management_System.git"
APP_DIR="/opt/data_intake"
BRANCH="main"

# ── Colores ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
setup() {
    info "Instalando dependencias del sistema..."
    apt-get update -qq
    apt-get install -y -qq curl git ufw

    # Docker
    if ! command -v docker &>/dev/null; then
        info "Instalando Docker..."
        curl -fsSL https://get.docker.com | sh
    else
        info "Docker ya instalado: $(docker --version)"
    fi

    # Docker Compose plugin
    if ! docker compose version &>/dev/null; then
        info "Instalando Docker Compose plugin..."
        apt-get install -y -qq docker-compose-plugin
    fi

    # Firewall básico
    info "Configurando UFW..."
    ufw allow OpenSSH
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable

    # Clonar repositorio
    if [ -d "$APP_DIR" ]; then
        warn "El directorio $APP_DIR ya existe. Usa 'update' para actualizar."
    else
        info "Clonando repositorio en $APP_DIR..."
        git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    fi

    # Crear .env si no existe
    if [ ! -f "$APP_DIR/.env" ]; then
        cp "$APP_DIR/.env.example" "$APP_DIR/.env"
        warn "Archivo .env creado desde .env.example."
        warn "EDITA $APP_DIR/.env antes de continuar:"
        warn "  nano $APP_DIR/.env"
        warn "Luego vuelve a ejecutar: bash deploy.sh start"
        exit 0
    fi

    start
}

# ─────────────────────────────────────────────────────────────────────────────
start() {
    [ -f "$APP_DIR/.env" ] || error "Falta $APP_DIR/.env — cópialo de .env.example y complétalo."

    info "Levantando servicios..."
    cd "$APP_DIR"
    docker compose -f docker-compose.prod.yml --env-file .env up -d --build

    info "Estado de los contenedores:"
    docker compose -f docker-compose.prod.yml ps

    info "Listo. La app está corriendo en http://$(grep '^DOMAIN=' .env | cut -d= -f2)"
}

# ─────────────────────────────────────────────────────────────────────────────
update() {
    [ -d "$APP_DIR" ] || error "Directorio $APP_DIR no encontrado. Ejecuta primero: bash deploy.sh setup"

    info "Actualizando código..."
    cd "$APP_DIR"
    git pull origin "$BRANCH"

    info "Reconstruyendo e iniciando servicios..."
    docker compose -f docker-compose.prod.yml --env-file .env up -d --build

    info "Limpiando imágenes antiguas..."
    docker image prune -f

    info "Actualización completada."
    docker compose -f docker-compose.prod.yml ps
}

# ─────────────────────────────────────────────────────────────────────────────
logs() {
    cd "$APP_DIR"
    docker compose -f docker-compose.prod.yml logs -f --tail=100
}

# ─────────────────────────────────────────────────────────────────────────────
stop() {
    cd "$APP_DIR"
    docker compose -f docker-compose.prod.yml down
}

# ─────────────────────────────────────────────────────────────────────────────
case "${1:-help}" in
    setup)  setup  ;;
    start)  start  ;;
    update) update ;;
    logs)   logs   ;;
    stop)   stop   ;;
    *)
        echo "Uso: bash deploy.sh [setup|start|update|logs|stop]"
        echo ""
        echo "  setup   — Instala Docker, clona el repo, configura firewall (primera vez)"
        echo "  start   — Levanta los contenedores con docker compose"
        echo "  update  — Actualiza código y reinicia contenedores"
        echo "  logs    — Muestra logs en tiempo real"
        echo "  stop    — Detiene todos los contenedores"
        ;;
esac
