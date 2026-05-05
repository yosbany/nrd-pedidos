#!/bin/bash
#
# Script para configurar los hooks de git pre-commit y pre-push
# que actualizan automáticamente la versión antes de cada commit/push
#

HOOK_PRE_COMMIT=".git/hooks/pre-commit"
HOOK_PRE_PUSH=".git/hooks/pre-push"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Setup pre-commit hook
cat > "$HOOK_PRE_COMMIT" << EOF
#!/bin/sh
#
# Pre-commit hook para actualizar la versión automáticamente
#

# Ejecutar el script de actualización de versión
python3 "$PROJECT_ROOT/tools/update-version/update-version.py"

# Agregar el index.html actualizado al staging area
git add index.html

exit 0
EOF

chmod +x "$HOOK_PRE_COMMIT"

# Setup pre-push hook
cat > "$HOOK_PRE_PUSH" << EOF
#!/bin/bash

# Update version with timestamp before push
echo "🔄 Updating version with timestamp..."
PROJECT_ROOT="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
python3 "\$PROJECT_ROOT/tools/update-version/update-version.py"

# Add the updated index.html to staging
git add index.html

echo "✅ Version updated and index.html staged for commit"
EOF

chmod +x "$HOOK_PRE_PUSH"

echo "✅ Hooks de git configurados correctamente"
echo "📝 Pre-commit hook: Actualiza versión antes de cada commit"
echo "📝 Pre-push hook: Actualiza versión antes de cada push"
echo ""
echo "Para usar manualmente: python3 tools/update-version/update-version.py"
