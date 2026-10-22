# Ejemplos simulados

Estos archivos proceden de `npm.cmd run scenarios -- --mock`. Ejecutan el grafo y las herramientas reales con un modelo programado, sin conexión ni consumo de Anthropic.

- `E1.json`–`E5.json` y `START.json`: resultados técnicos de escenarios independientes.
- `handoffs.json`: transferencias observadas en la simulación.
- `summary.json`: resumen de rutas y errores.
- `rubric.json`: plantilla manual sin completar; no hay calificaciones automáticas.

Para obtener evidencia con Claude, añade la clave a `.env` y ejecuta `npm.cmd run scenarios`. Los nuevos resultados se guardan en `outputs/runs/`; no sobrescriben estos ejemplos. No comparar las latencias o tokens de estos ejemplos con llamadas reales.
