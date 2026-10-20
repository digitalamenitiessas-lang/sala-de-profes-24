#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy de Sala de Profes 24 a la VPS (reemplaza al deploy de Vercel).
#
# La VPS no tiene acceso al repo privado de GitHub: se lleva la rama main como
# git bundle (un clon real, con historial), se actualiza el clon de
# /home/salaprofes24 y se compila con prioridad baja (Nice=15, para no frenar a
# los bots).
#
# Sin cortes: el build va a la carpeta que NO está en uso (.next-a / .next-b) y
# recién al terminar el servicio pasa a la nueva (NEXT_DIST_DIR en
# /etc/salaprofes24/dist.env) y se reinicia (unos segundos). Antes, `next build`
# vaciaba .next con la app andando y quien entraba veía la pantalla en blanco.
# No se puede compilar aparte y renombrar: cada ruta guarda el nombre de su
# carpeta. `npm ci` (que borra node_modules) solo corre si cambió el lock.
#
# Si el build falla, o la versión nueva no levanta, queda la anterior.
# Volver a la versión previa a mano: poner la otra carpeta en dist.env y
# `systemctl restart salaprofes24` (la previa queda hasta el deploy siguiente).
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

# Carpeta en uso y carpeta nueva (sin dist.env = .next, el esquema viejo).
DIST_ENV=/etc/salaprofes24/dist.env
ACTIVA=\$(sed -n 's/^NEXT_DIST_DIR=//p' \$DIST_ENV 2>/dev/null || true)
[ "\$ACTIVA" = ".next-a" ] && NUEVA=.next-b || NUEVA=.next-a

correr() {
  systemd-run --quiet --wait --collect --pipe \
    -p User=salaprofes24 -p Group=salaprofes24 -p Nice=15 -p CPUWeight=20 -p IOWeight=20 -p MemoryMax=2200M \
    -p EnvironmentFile=/etc/salaprofes24/app.env -p WorkingDirectory=$APP \
    -E HOME=/home/salaprofes24 -E PATH=/opt/node22/bin:/usr/bin:/bin -E NEXT_TELEMETRY_DISABLED=1 \
    -E NODE_OPTIONS=--max-old-space-size=1800 -E NEXT_DIST_DIR=\$NUEVA "\$@"
}

LOCK=\$(sha256sum $APP/package-lock.json | cut -d' ' -f1)
if [ "\$(cat $APP/node_modules/.sp24-lock.sha256 2>/dev/null || true)" = "\$LOCK" ]; then
  echo "🔧 Dependencias sin cambios"
else
  echo "🔧 Instalando dependencias (cambió package-lock.json; puede cortar unos segundos)…"
  correr /opt/node22/bin/npm ci --include=dev --no-audit --no-fund >/tmp/sp24-deploy.log 2>&1 || { tail -20 /tmp/sp24-deploy.log; exit 1; }
  echo "\$LOCK" | sudo -u salaprofes24 tee $APP/node_modules/.sp24-lock.sha256 >/dev/null
fi

echo "🏗️  Compilando en \$NUEVA (prioridad baja, ~2 min; la app sigue andando)…"
correr /opt/node22/bin/node node_modules/next/dist/bin/next build >>/tmp/sp24-deploy.log 2>&1 || { tail -30 /tmp/sp24-deploy.log; echo "❌ Falló el build: la app sigue con la versión anterior (\${ACTIVA:-.next})."; exit 1; }
rm -f /tmp/sp24-deploy.log

usar() {
  if [ -n "\$1" ]; then echo "NEXT_DIST_DIR=\$1" > \$DIST_ENV.tmp && chmod 644 \$DIST_ENV.tmp && mv \$DIST_ENV.tmp \$DIST_ENV; else rm -f \$DIST_ENV; fi
  systemctl restart salaprofes24.service
  for i in \$(seq 1 20); do
    [ "\$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3070/login)" = "200" ] && return 0
    sleep 1
  done
  return 1
}
if usar \$NUEVA; then
  echo "✅ Servicio activo con \$NUEVA"
  # La carpeta del esquema viejo ya no la usa nadie una vez que hay una previa a/b.
  if [ -n "\$ACTIVA" ]; then rm -rf $APP/.next; fi
else
  journalctl -u salaprofes24 -n 20 --no-pager
  echo "❌ La versión nueva no levantó: se vuelve a \${ACTIVA:-.next}."
  usar "\$ACTIVA" && echo "↩️  Volvió la versión anterior" || echo "⚠️  Tampoco levantó la anterior: revisar YA"
  exit 1
fi
REMOTO

code=$(curl -s -o /dev/null -m 20 -w "%{http_code}" "$URL/login")
echo "🌐 $URL/login → $code"
[ "$code" = "200" ]
