# 🚀 Setup Rápido - ATC Challenge

## Levantar el Proyecto (1 comando)

```bash
docker-compose up -d --build
```

**Esto levanta automáticamente:**

- ✅ API Principal (puerto 3000)
- ✅ API Mock (puerto 4000)
- ✅ Redis (puerto 6379)

## Validar que Funciona

### Health Check

```bash
curl "http://localhost:3000/search/health"
```

**Esperado:** Status "ok" con métricas

### Test de Performance

```bash
# Segunda request (rápida - cache hit)
time curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-29"
```

**Esperado:** Segunda request >50% más rápida

## Ejecutar Tests

### Tests Unitarios (200 tests)

```bash
npm test
```

### Tests de Integración

```bash
npm run test:e2e
```

## Parar el Proyecto

```bash
docker-compose down
```

---
