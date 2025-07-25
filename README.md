## Intro

Bienvenido/a al desafío técnico de ATC. Este proyecto simula un servicio de búsqueda de disponibilidad de canchas,
el cuál está tardando mucho y no tolera gran cantidad de solicitudes por minuto.

El objetivo de este desafío es optimizar el servicio para que responda lo más rápido posible, con información actualizada
y que soporte altos niveles de tráfico.

## El proyecto

El servicio de disponibilidad devuelve, a partir de un [Place Id](https://developers.google.com/maps/documentation/places/web-service/place-id) y fecha, todos los clubes de la zona, con sus respectivos atributos, canchas y disponibilidad. Ejemplos de respuestas se encuentran dentro de `mock/data/`.

El proyecto consta de dos partes

1. La API principal, sobre la que hay que trabajar y que está desarrollada en [NestJS](https://github.com/nestjs/nest) adaptada a una Arquitectura Hexagonal.
2. Una API mock, desarrollada en JS vanilla y que **no** debe ser modificada

La API mock es la fuente de verdad y a su vez nuestro cuello de botella. Los endpoints que expone son

- `GET /zones`: Lista todas las zones donde tenemos clubes
- `GET /clubs?placeId`: Lista los clubes por zona
- `GET /clubs/:id`: Detalla un club
- `GET /clubs/:id/courts`: Lista las canchas de un club
- `GET /clubs/:id/courts/:id`: Detalla una cancha de un club
- `GET /clubs/:id/courts/:id/slots?date`: Lista la disponibilidad una cancha para una fecha en particular

> Estos endpoints tienen un latencia alta y la API en general tiene un límite de 60 solicitudes por minuto.

A su vez, la API mock tiene la capacidad de avisar a la API principal cada vez que ocurren modificaciones. Los eventos posibles son los siguientes

- Se ocupa un lugar (`booking_created`)
- Se libera un lugar (`booking_cancelled`)
- Se actualiza un club (`club_updated`)
- Se actualiza una cancha (`court_updated`)

En algunos casos, estos eventos modifican la disponibilidad de la cancha.
Por ejemplo, cuando se ocupa un lugar en la cancha 140 el 25 de Agosto a las 10:30, la disponibilidad para esa fecha debe ser actualizada.
Lo mismo ocurre cuando se libera un lugar.

En otros casos, los eventos no modifican las disponibilidad de la cancha, pero sí la información estática. Por ejemplo, si se cambia el nombre
de la cancha 140, el servicio debe reflejar el nuevo nombre

**Atención**: cuando se actualiza un club, dependiendo de los atributos a actualizar, puede que modifique o no la disponibilidad. Hay un atributo
especial llamado `open_hours` que refleja el horario de apertura y cierre de los complejos según el día de la semana, si este cambia, puede afectar la disponibilidad. El resto de los atributos no modifican la disponibilidad

> Un evento al azar ocurre cada 10 segundos. Durante el desarrollo se puede modificar el intervalo a gusto a través de la variable
> de entorno `EVENT_INTERVAL_SECONDS`, pero la solución debe funcionar independientemente del valor

## Solución Implementada - Optimización de Performance

Esta implementación resuelve los problemas de performance del servicio de búsqueda de disponibilidad mediante:

### 🚀 Optimizaciones Principales

1. **Sistema de Cache Distribuido con Redis**

   - Cache inteligente con TTL diferenciado por tipo de recurso
   - Clubs: 1 hora (cambian poco frecuentemente)
   - Courts: 30 minutos (cambian ocasionalmente)
   - Slots: 5 minutos (cambian frecuentemente)

2. **Rate Limiting Inteligente**

   - Algoritmo Token Bucket que respeta estrictamente 60 requests/minuto
   - Distribución de requests entre múltiples instancias
   - Degradación elegante cuando se alcanza el límite

3. **Circuit Breaker Pattern**

   - Protección contra fallos de la API mock
   - Fallback automático a datos cacheados cuando la API está caída
   - Auto-recuperación cuando el servicio vuelve a estar disponible

4. **Invalidación de Cache Basada en Eventos**

   - Invalidación selectiva según tipo de evento
   - `booking_created/cancelled`: invalida slots específicos
   - `club_updated` (con `open_hours`): invalida todos los slots del club
   - `court_updated`: invalida datos de cancha específica

5. **Optimización de Consultas**
   - Eliminación del problema N+1 mediante cache
   - Ejecución concurrente de requests independientes
   - Deduplicación de requests idénticos

### 📊 Monitoreo y Observabilidad

- **Métricas de Cache**: Hit ratio, operaciones, performance
- **Métricas de Rate Limiting**: Utilización, requests permitidos/denegados
- **Health Check Comprehensivo**: Estado de Redis, API, métricas en tiempo real
- **Logging Estructurado**: Para sistemas de monitoreo

## Configuración y Ejecución para Evaluadores

### Prerrequisitos

- Node.js 16+ (definido en `.nvmrc`)
- Docker y Docker Compose
- Yarn package manager

### 🔧 Setup Completo

1. **Clonar y configurar el proyecto**

```bash
git clone <repository-url>
cd atc-backend-challenge
yarn install
```

2. **Levantar todos los servicios con Docker Compose**

```bash
docker-compose up -d --build
```

Esto levanta:

- **API Principal** (puerto 3000) - Con todas las optimizaciones
- **API Mock** (puerto 4000) - Fuente de verdad (NO MODIFICAR)
- **Redis** (puerto 6379) - Cache distribuido

3. **Verificar que todos los servicios estén funcionando**

```bash
docker-compose ps
```

Deberías ver 3 servicios corriendo: `api`, `mock`, `redis`

### 🧪 Validación de la Solución

#### 1. Health Check del Sistema

```bash
curl "http://localhost:3000/search/health" | jq .
```

Respuesta esperada:

```json
{
  "status": "ok",
  "timestamp": "2025-07-25T16:52:37.639Z",
  "services": {
    "redis": {
      "connected": true,
      "ping": "PONG",
      "operational": true,
      "error": null
    },
    "api": {
      "status": "ok",
      "uptime": 37.117764684
    }
  },
  "metrics": {
    "totalRequests": 1,
    "cacheHitRatio": 0.46,
    "cacheStats": {
      "hits": 23,
      "misses": 27,
      "total": 50,
      "hitRatio": 0.46,
      "operations": {
        "gets": 50,
        "sets": 25,
        "deletes": 4,
        "invalidations": 7
      }
    }
  }
}
```

#### 2. Test de Performance - Primera Request (Cache Miss)

```bash
time curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-26"
```

#### 3. Test de Performance - Segunda Request (Cache Hit)

```bash
time curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-26"
```

**Resultado esperado**: La segunda request debería ser significativamente más rápida (>50% mejora)

#### 4. Test de Validación de Fechas

```bash
# Fecha en el pasado - debería fallar
curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-01-01"

# Fecha muy futura - debería fallar
curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-12-31"

# Fecha válida (hoy + 1-6 días) - debería funcionar
curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-27"
```

### 🔬 Tests Automatizados

#### Ejecutar Tests Unitarios (165 tests)

```bash
npm test
```

#### Ejecutar Tests de Integración

```bash
npm run test:e2e
```

#### Tests Específicos de Performance

```bash
# Test de cache performance
npm run test:e2e -- --testNamePattern="Cache Performance"

# Test de rate limiting
npm run test:e2e -- --testNamePattern="Rate Limiting"

# Test de circuit breaker
npm run test:e2e -- --testNamePattern="Circuit Breaker"
```

### 📈 Validación de Métricas de Performance

#### Test de Carga Concurrente

```bash
# Instalar herramienta de load testing
npm install -g autocannon

# Test de 10 requests concurrentes por 30 segundos
autocannon -c 10 -d 30 "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-26"
```

#### Monitoreo de Rate Limiting

```bash
# Hacer múltiples requests rápidas para ver rate limiting en acción
for i in {1..70}; do
  curl -w "%{http_code} - %{time_total}s\n" -o /dev/null -s \
    "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-26"
done
```

### 🔄 Test de Invalidación de Cache por Eventos

1. **Hacer una request para poblar cache**

```bash
curl "http://localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-26" > /dev/null
```

2. **Verificar métricas de cache**

```bash
curl "http://localhost:3000/search/health" | jq '.metrics.cacheStats'
```

3. **Los eventos se generan automáticamente cada 10 segundos desde la API mock**
   - Observar los logs para ver invalidaciones de cache
   - Verificar que las métricas de cache se actualizan

### 🛠 Troubleshooting

#### Si Redis no se conecta:

```bash
docker-compose logs redis
docker-compose restart redis
```

#### Si la API mock no responde:

```bash
docker-compose logs mock
curl "http://localhost:4000/zones"  # Test directo
```

#### Ver logs de la API principal:

```bash
docker-compose logs api -f
```

#### Reiniciar todo el sistema:

```bash
docker-compose down
docker-compose up -d --build
```

### 📋 Checklist de Validación para Evaluadores

- [ ] ✅ Todos los servicios levantan correctamente con `docker-compose up -d --build`
- [ ] ✅ Health check responde con status "ok" y métricas de cache
- [ ] ✅ Primera request es más lenta (cache miss)
- [ ] ✅ Segunda request es significativamente más rápida (cache hit)
- [ ] ✅ Validación de fechas funciona (rechaza pasado y >7 días futuro)
- [ ] ✅ Tests unitarios pasan (165 tests)
- [ ] ✅ Tests de integración demuestran mejoras de performance
- [ ] ✅ Rate limiting respeta 60 requests/minuto
- [ ] ✅ Sistema funciona cuando Redis está caído (degradación elegante)
- [ ] ✅ Cache se invalida correctamente con eventos
- [ ] ✅ Métricas de monitoreo funcionan correctamente

### 🎯 Resultados Esperados

- **Mejora de Performance**: >50% reducción en tiempo de respuesta para requests cacheadas
- **Rate Limiting**: Estricto cumplimiento de 60 requests/minuto
- **Disponibilidad**: Sistema funciona incluso cuando API mock está caída
- **Consistencia**: Cache se mantiene actualizado mediante eventos
- **Monitoreo**: Métricas completas para observabilidad en producción

### ⚙️ Variables de Entorno y Configuración

El sistema soporta las siguientes variables de entorno para personalización:

#### Variables de Cache (Redis)

```bash
REDIS_URL=redis://localhost:6379          # URL de conexión a Redis
CACHE_TTL_CLUBS=3600                      # TTL para clubs (1 hora)
CACHE_TTL_COURTS=1800                     # TTL para courts (30 min)
CACHE_TTL_SLOTS=300                       # TTL para slots (5 min)
```

#### Variables de Rate Limiting

```bash
RATE_LIMIT_RPM=60                         # Requests por minuto (default: 60)
RATE_LIMIT_BUCKET_TTL_SECONDS=120         # TTL del bucket (2 min)
RATE_LIMIT_MAX_WAIT_TIME_MS=60000         # Tiempo máximo de espera (1 min)
RATE_LIMIT_CHECK_INTERVAL_MS=100          # Intervalo de verificación (100ms)
```

#### Variables de Circuit Breaker

```bash
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5      # Fallos antes de abrir (default: 5)
CIRCUIT_BREAKER_RECOVERY_TIMEOUT=60000   # Timeout de recuperación (1 min)
CIRCUIT_BREAKER_MONITORING_PERIOD=60000  # Período de monitoreo (1 min)
```

#### Variables de la API Mock

```bash
ATC_BASE_URL=http://localhost:4000        # URL de la API mock
EVENT_INTERVAL_SECONDS=10                 # Intervalo de eventos (10 seg)
```

### 🔧 Configuración Personalizada

Para modificar la configuración, crear un archivo `.env` en la raíz del proyecto:

```bash
# .env
REDIS_URL=redis://localhost:6379
CACHE_TTL_CLUBS=7200
RATE_LIMIT_RPM=120
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
EVENT_INTERVAL_SECONDS=5
```

### 📚 Documentación Técnica Adicional

- **Decisiones Técnicas**: Ver `TECHNICAL_DECISIONS.md` para justificaciones detalladas
- **Arquitectura**: El proyecto mantiene la Arquitectura Hexagonal original
- **Patrones Implementados**: Cache-Aside, Circuit Breaker, Token Bucket, Event-Driven Cache Invalidation

### Requests de ejemplo actualizados

```bash
# Request básica
curl "localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-26"

# Health check con métricas
curl "localhost:3000/search/health" | jq .

# Test de performance (ejecutar varias veces para ver cache hits)
time curl "localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=2025-07-26"

# Test con diferentes fechas válidas
curl "localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=$(date -d '+1 day' '+%Y-%m-%d')"
curl "localhost:3000/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=$(date -d '+3 days' '+%Y-%m-%d')"
```

### Entregar

El método de entrega es a través de un pull request a este repositorio.

1. [Hacer un fork](https://help.github.com/articles/fork-a-repo/) de este repositorio
2. [Crear un pull request](https://help.github.com/articles/creating-a-pull-request-from-a-fork/)
3. En la descripción del pull request se aprecia documentar decisiones, investigaciones, supociones o iteraciones futuras

Las consultas se pueden hacer por privado o creando un issue en este repositorio

Qué vamos a evaluar? La idea es que este desafío se asemeje lo máximo posible a una tarea del día a día, por eso proveemos un proyecto con una aplicación ya configurada y lista para modificar. Esto significa que

- Se espera que se agreguen tests que comprueben el correcto funcionamiento de lo desarrollado
- Se espera que se entienda y se respete la arquitectura de la aplicación
- Si se decide investigar técnicas y/o patrones para resolver este problema, está perfecto y nos gustaría saber los links consultados
- Son bienvenidas las consultas, como en cualquier equipo resolvemos las cosas juntos
- En caso de falta de tiempo o no se sepa como resolver alguna cuestión en particular, se valora la priorización para atacar lo más importante y documentar lo que faltaría y como lo resolverían

## Reglas y tips

- No se puede modificar la API mock para resolver el desafío
- Asumir que sólo se recibirán consultas para fechas dentro de los próximos 7 días
- Asumir que la API mock puede estar caída en todo momento
- Es preferible devolver resultados desactualizados que no devolver nada
- Se puede modificar el `docker-compose.yml` para agregar cualquier dependencia que se necesite
- No hace falta implementar lógica de disponibilidad al reaccionar a los eventos, siempre se puede consultar la disponibilidad actualizada a la API mock por cancha y fecha
- A modo de comprobación hay un endpoint en la API mock (`/test?placeId&date`) que devuelve la disponibilidad como debería ser devuelta por la API principal
- No se puede usar el endpoint de test de la API mock para resolver el desafío
