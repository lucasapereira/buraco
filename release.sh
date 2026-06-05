#!/usr/bin/env bash
#
# release.sh — bump de versão + build AAB + upload pra Play Console.
#
# Uso:
#   ./release.sh 2.3.0              # sobe pro track internal (padrão)
#   ./release.sh 2.3.0 beta         # sobe pro track beta
#   ./release.sh 2.3.0 production   # sobe direto pro production (release_status=draft)
#
# Pré-requisitos:
#   - bundle install (vendor/bundle local, já feito)
#   - fastlane/play-store-key.json (service account com permissão de Release Manager)
#   - keystore configurado em android/gradle.properties
#
# O script:
#   1. Valida formato da versão
#   2. Bump versionCode (+1) e versionName em app.json + android/app/build.gradle
#   3. Avisa se faltar changelog do novo versionCode
#   4. Build AAB via gradle
#   5. Copia AAB pra raiz como Buraco-v<versão>-release.aab
#   6. Upload via fastlane supply

set -euo pipefail

VERSION="${1:-}"
TRACK="${2:-internal}"

if [[ -z "$VERSION" ]]; then
  cat <<EOF
Uso: $0 <versão> [track]

  versão : X.Y.Z (ex: 2.3.0)
  track  : internal (default) | alpha | beta | production
EOF
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✗ Versão inválida: '$VERSION' (esperado X.Y.Z, ex: 2.3.0)"
  exit 1
fi

case "$TRACK" in
  internal|alpha|beta|production) ;;
  *) echo "✗ Track inválido: '$TRACK' (use internal/alpha/beta/production)"; exit 1 ;;
esac

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# ── 1. Calcula versionCode novo ────────────────────────────────────────────
CURRENT_CODE=$(grep '"versionCode"' app.json | grep -oE '[0-9]+' | head -1)
if [[ -z "$CURRENT_CODE" ]]; then
  echo "✗ Não achei versionCode em app.json"
  exit 1
fi
NEW_CODE=$((CURRENT_CODE + 1))

echo "▸ Bump: v$VERSION (versionCode $CURRENT_CODE → $NEW_CODE), track: $TRACK"

# ── 2. Atualiza app.json e build.gradle ────────────────────────────────────
# macOS sed precisa de '' depois do -i. GNU sed não. Forma portátil:
sed_inplace() {
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

sed_inplace -E "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" app.json
sed_inplace -E "s/\"versionCode\": [0-9]+/\"versionCode\": $NEW_CODE/" app.json
sed_inplace -E "s/versionCode [0-9]+/versionCode $NEW_CODE/" android/app/build.gradle
sed_inplace -E "s/versionName \"[^\"]*\"/versionName \"$VERSION\"/" android/app/build.gradle

echo "  ✓ app.json e build.gradle atualizados"

# ── 3. Avisa sobre changelog ───────────────────────────────────────────────
CHANGELOG_PT="fastlane/metadata/android/pt-BR/changelogs/${NEW_CODE}.txt"
if [[ ! -f "$CHANGELOG_PT" ]]; then
  echo ""
  echo "⚠️  Não achei $CHANGELOG_PT"
  echo "    O fastlane vai subir sem changelog pra esse versionCode (ou reutilizar"
  echo "    o último disponível, dependendo da config). Recomendo criar pelo menos"
  echo "    o pt-BR antes de continuar:"
  echo ""
  echo "      mkdir -p fastlane/metadata/android/pt-BR/changelogs"
  echo "      echo 'Suas notas aqui' > $CHANGELOG_PT"
  echo ""
  read -p "Continuar mesmo assim? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || { echo "Abortado."; exit 1; }
fi

# ── 4. Build AAB ───────────────────────────────────────────────────────────
echo "▸ Build AAB (gradle bundleRelease)..."
(cd android && ./gradlew bundleRelease)

# ── 5. Copia AAB pra raiz com nome versionado ──────────────────────────────
AAB_OUT="Buraco-v${VERSION}-release.aab"
cp android/app/build/outputs/bundle/release/app-release.aab "$AAB_OUT"
echo "  ✓ AAB copiado: $AAB_OUT"

# ── 6. Upload via fastlane ─────────────────────────────────────────────────
if [[ ! -f "fastlane/play-store-key.json" ]]; then
  echo ""
  echo "✗ Service account JSON não encontrado em fastlane/play-store-key.json"
  echo "  Crie no Google Cloud Console (veja docs/RELEASE.md) e coloque o arquivo lá."
  echo "  Build feito mas upload pulado. AAB tá em $AAB_OUT (pode subir manualmente no Play Console)."
  exit 1
fi

echo "▸ Upload pra Play Console (track: $TRACK)..."
bundle exec fastlane deploy track:"$TRACK"

echo ""
echo "✓ Pronto! v$VERSION (code $NEW_CODE) no track '$TRACK'."
[[ "$TRACK" != "production" ]] && echo "  Promova manualmente no Play Console quando estiver pronto: $TRACK → production"
