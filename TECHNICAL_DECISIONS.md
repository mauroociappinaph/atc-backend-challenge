# Justificaciones Técnicas - ATC Challenge

## ¿Por qué elegí Redis como sistema de cache?

Decidí usar Redis por varias razones clave:

- **Persistencia**: Mantiene datos en memoria entre reinicios de la API
- **TTL nativo**: Control automático de expiración sin intervención manual
- **Concurrencia**: Múltiples instancias de API pueden compartir el mismo cache
- **Performance**: Acceso ultra-rápido a datos cacheados

## ¿Por qué Token Bucket para Rate Limiting?

Opté por este algoritmo porque:

- **Cumplimiento estricto**: Garantiza exactamente 60 RPM (requerimiento del README)
- **Manejo de ráfagas**: Permite requests agrupadas sin romper el límite
- **Distribución**: Funciona correctamente con múltiples instancias
- **Flexibilidad**: Configurable para diferentes escenarios de tráfico

## ¿Por qué implementé Circuit Breaker?

El objetivo fue mejorar la resiliencia del sistema:

- **Fallback inteligente**: Responde con cache cuando API mock falla
- **Auto-recovery**: Se recupera automáticamente sin intervención manual
- **Prevención de cascada**: Evita que fallos se propaguen
- **Experiencia de usuario**: Prefiere datos desactualizados a no datos

## ¿Por qué TTL diferenciado por tipo de recurso?

Cada tipo de dato tiene diferente frecuencia de cambio:

- **Clubs (1 hora)**: Cambian raramente, cache largo es seguro
- **Courts (30 minutos)**: Cambios ocasionales, balance cache/freshness
- **Slots (5 minutos)**: Cambian frecuentemente, cache corto para precisión

Esta estrategia optimiza performance manteniendo consistencia.

## ¿Por qué invalidación basada en eventos?

Es la mejor forma de mantener consistencia en tiempo real:

- **Eventos del README**: Maneja `booking_created`, `booking_cancelled`, `club_updated`, `court_updated`
- **Invalidación selectiva**: Solo actualiza lo que realmente cambió
- **Eficiencia**: Evita invalidar todo el cache innecesariamente
- **Consistencia**: Los usuarios ven cambios inmediatamente

## Cumplimiento de Requerimientos del README

✅ **API Mock no modificada**: Respetada como fuente de verdad
✅ **60 RPM límite**: Implementado con Token Bucket
✅ **Eventos cada 10 segundos**: Manejados correctamente
✅ **Arquitectura Hexagonal**: Mantenida y respetada
✅ **Ventana de 7 días**: Validación implementada
✅ **open_hours especial**: Invalidación específica para este atributo
