#!/bin/bash

# Lista de archivos que necesitan ser actualizados
files=(
  "test/rate-limiting-integration.e2e-spec.ts"
  "test/search-flow-integration.e2e-spec.ts"
  "test/response-format.e2e-spec.ts"
  "test/performance-load.e2e-spec.ts"
  "test/performance-validation.e2e-spec.ts"
  "test/cache-performance.e2e-spec.ts"
  "test/performance-load-simple.e2e-spec.ts"
)

echo "Actualizando fechas hardcodeadas en tests e2e..."

for file in "${files[@]}"; do
  echo "Procesando: $file"

  # Verificar si el archivo ya tiene el import
  if ! grep -q "TestDateUtils" "$file"; then
    # Agregar el import después de los otros imports
    sed -i '' '/import \* as request from '\''supertest'\'';/a\
\
import { TestDateUtils } from '\''./utils/test-dates'\'';
' "$file"
  fi

  # Reemplazar fechas hardcodeadas
  sed -i '' "s/'2025-07-26'/TestDateUtils.getValidTestDate()/g" "$file"
  sed -i '' "s/'2025-07-27'/TestDateUtils.getValidTestDate()/g" "$file"
  sed -i '' 's/const testDate = TestDateUtils.getValidTestDate();/const testDate = TestDateUtils.getValidTestDate();/g' "$file"

  echo "  ✅ Actualizado: $file"
done

echo ""
echo "✅ Todos los archivos han sido actualizados!"
echo ""
echo "Archivos procesados:"
for file in "${files[@]}"; do
  echo "  - $file"
done
