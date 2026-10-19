#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy de Sala de Profes 24 a la VPS (reemplaza al deploy de Vercel).
#
# La VPS no tiene acceso al repo privado de GitHub: se lleva la rama main como
# git bundle (un clon real, con historial), se actualiza el clon de
# /home/salaprofes24, se instala, se compila con prioridad baja (Nice=15, para
# no frenar a los bots) y se reinicia el servicio. Si el build falla, el
# servicio sigue con la versión anterior.
#
# Uso (desde la raíz del repo, con main pusheado):
#   bash scripts/deploy-vps.sh
# ---------------------------------------------------------------------------
set -euo pipefail

VPS=root@2.25.185.242
APP=/home/salaprofes24/sala-de-profes-24
URL=https://lve24.com.ar

if [ -n "$(git status --porcelain)" ]; then echo "❌ Hay cambios sin commitear."; exit 1; fi
if [ "$(git rev-parse main)" != "$(git rev-parse origin/main 2>/dev/null)" ]; then
  echo "❌ main no está pusheado a GitHub (git push origin main)."; exit 1
fi

BUNDLE=$(mktemp -t sp24).bundle
git bundle create "$BUNDLE" main >/dev/null 2>&1
scp -q "$BUNDLE" "$VPS:/tmp/sp24.bundle"
rm -f "$BUNDLE"
echo "📦 Código enviado: $(git log --oneline -1 main)"

ssh "$VPS" bash -s <<REMOTO
set -euo pipefail
chown salaprofes24:salaprofes24 /tmp/sp24.bundle
sudo -u salaprofes24 git -C $APP fetch -q /tmp/sp24.bundle main
sudo -u salaprofes24 git -C $APP reset -q --hard FETCH_HEAD
rm -f /tmp/sp24.bundle
echo "📥 VPS en: \$(sudo -u salaprofes24 git -C $APP log --oneline -1)"

correr() {
  systemd-run --quiet --wait --collect --pipe \
    -p User=salaprofes24 -p Group=salaprofes24 -p Nice=15 -p CPUWeight=20 -p IOWeight=20 -p MemoryMax=2200M \
    -p EnvironmentFile=/etc/salaprofes24/app.env -p WorkingDirectory=$APP \
    -E HOME=/home/salaprofes24 -E PATH=/opt/node22/bin:/usr/bin:/bin -E NEXT_TELEMETRY_DISABLED=1 \
    -E NODE_OPTIONS=--max-old-space-size=1800 "\$@"
}
echo "🔧 Instalando dependencias…"
correr /opt/node22/bin/npm ci --include=dev --no-audit --no-fund >/tmp/sp24-deploy.log 2>&1 || { tail -20 /tmp/sp24-deploy.log; exit 1; }
echo "🏗️  Compilando (prioridad baja, ~1-2 min)…"
correr /opt/node22/bin/node node_modules/next/dist/bin/next build >>/tmp/sp24-deploy.log 2>&1 || { tail -30 /tmp/sp24-deploy.log; echo "❌ Falló el build: el servicio sigue con la versión anterior en memoria, pero NO lo reinicies hasta arreglarlo."; exit 1; }
rm -f /tmp/sp24-deploy.log
systemctl restart salaprofes24.service
sleep 6
systemctl is-active --quiet salaprofes24.service && echo "✅ Servicio activo" || { journalctl -u salaprofes24 -n 20 --no-pager; exit 1; }
REMOTO

code=$(curl -s -o /dev/null -m 20 -w "%{http_code}" "$URL/login")
echo "🌐 $URL/login → $code"
[ "$code" = "200" ]
