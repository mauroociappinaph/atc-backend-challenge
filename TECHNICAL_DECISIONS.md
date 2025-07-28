## Justificaciones Técnicas - ATC Challenge

Para encarar el proyecto, primero analicé los requisitos del README, también utilicé el MCP (firecrawl) integrado en mi IDE para el análisis del README y me aseguré de respetarlos. Utilicé Cursor como IDE, ChatGPT, Gemini (deep search) y Perplexity para investigar las mejores soluciones técnicas. Configuré reglas para no modificar archivos restringidos y organicé el trabajo en tareas con subtareas, desarrollando y probando cada parte de forma progresiva.

Elegí Redis como sistema de caché porque me ofrecía persistencia en memoria, control automático del tiempo de vida de los datos (TTL), excelente rendimiento y soporte para múltiples instancias. Además, asigné diferentes TTL según el tipo de recurso: una hora para clubs, treinta minutos para courts y cinco minutos para slots. Esto me permitió mantener buena performance sin perder precisión en los datos más dinámicos.

Por otra parte, la consistencia en tiempo real, implementé invalidación de caché basada en eventos como booking_created, booking_cancelled, club_updated y court_updated, borrando solo lo necesario sin sobrecargar el sistema. También opté por el algoritmo Token Bucket para limitar las solicitudes a 60 por minuto, tal como exige el README. Este enfoque me permitió manejar ráfagas breves y mantener el control incluso en entornos con múltiples instancias.

Para mejorar la resiliencia del sistema, implementé un Circuit Breaker que permite responder desde el caché cuando la API externa falla. Esto evita errores en cascada, mejora la experiencia del usuario y permite una recuperación automática cuando el servicio vuelve a estar disponible.

Como mejora futura, aplicaría principios como DRY y SRP para tener un código más limpio y mantenible, además de crear funciones reutilizables y seguir optimizando el rendimiento general del sistema sin romper la arquitectura hexagonal.

Lo que no pude solucionar son errores en los handlers de los decoradores. El archivo me tira que no se le puede asignar un tipo “undefined” al parámetro de tipo “string | symbol”, igualmente los tests pasan y está todo funcional.

## DATO EXTRA

Por alguna razón que desconozco y que no he investigado por qué sucede, cada vez que hago push, commit o cualquier acción de GitHub —menos crear repos y algunas excepciones— aparece la contribución como porfirio-escamilla, pero soy yo.
