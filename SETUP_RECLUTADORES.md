# 🚀 Guía Rápida para Reclutadores - ATC Challenge

## Requisitos Previos

- Docker y Docker Compose instalados
- Puertos 3000, 4000 y 6379 disponibles

## Levantar el Proyecto (1 comando)

```bash
docker-compose up -d --build
```

**Esto levanta automáticamente:**

- ✅ API Principal (puerto 3000) - Con todas las optimizaciones
- ✅ API Mock (puerto 4000) - Fuente de verdad
- ✅ Redis (puerto 6379) - Cache distribuido

## Validar que Funciona

### 1. Health Check del Sistema

```bash
curl "http://localhost:3000/search/health"
```

**Respuesta esperada:** Status "ok" con métricas de Redis y cache

### 2. Test de Performance (Cache Miss → Cache Hit)

```bash
# Primera request (lenta - cache miss)
time curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-29"

# Segunda request (rápida - cache hit)
time curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-29"
```

**Resultado esperado:** Segunda request >50% más rápida

### 3. Validar Rate Limiting (60 RPM)

```bash
# Hacer 70 requests rápidas - las últimas 10 deberían ser rate limited
for i in {1..70}; do
  curl -w "%{http_code}\n" -o /dev/null -s \
    "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-29"
done
```

## Ejecutar Tests

### Tests Unitarios (200 tests)

```bash
npm test
```

### Tests de Integración

```bash
npm run test:e2e
```

## Optimizaciones Implementadas

- **🚀 Cache Redis**: TTL diferenciado por tipo de recurso
- **⚡ Rate Limiting**: Token bucket (60 RPM estricto)
- **🛡️ Circuit Breaker**: Fallback a cache cuando API mock falla
- **📊 Monitoreo**: Métricas completas de performance
- **🔄 Event-driven**: Invalidación de cache en tiempo real
- **🧪 Tests**: 200+ tests unitarios + integración

## Justificaciones Técnicas

### ¿Por qué Redis?

- **Persistencia**: Mantiene cache entre reinicios de la API
- **TTL automático**: Expira datos sin intervención manual
- **Concurrencia**: Múltiples instancias pueden compartir cache

### ¿Por qué Token Bucket para Rate Limiting?

- **Cumplimiento estricto**: Garantiza exactamente 60 RPM
- **Manejo de ráfagas**: Permite requests agrupadas hasta el límite
- **Distribución**: Funciona con múltiples instancias de API

### ¿Por qué Circuit Breaker?

- **Resiliencia**: API sigue funcionando cuando mock API falla
- **Fallback inteligente**: Prefiere datos desactualizados a no datos
- **Auto-recovery**: Se recupera automáticamente sin intervención

### ¿Por qué TTL diferenciado?

- **Clubs (1h)**: Cambian raramente, cache largo es seguro
- **Courts (30min)**: Cambios ocasionales, balance cache/freshness
- **Slots (5min)**: Cambian frecuentemente, cache corto para precisión

### ¿Por qué Event-driven Invalidation?

- **Consistencia**: Cache se actualiza inmediatamente con cambios
- **Eficiencia**: Solo invalida lo que realmente cambió
- **Tiempo real**: Usuarios ven cambios sin esperar TTL

## Arquitectura Respetada

✅ Hexagonal Architecture mantenida
✅ API Mock NO modificada (fuente de verdad)
✅ Todos los requerimientos del challenge cumplidos

## Parar el Proyecto

```bash
docker-compose down
```

---
