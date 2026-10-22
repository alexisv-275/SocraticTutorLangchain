# Registro de implementación

Los documentos originales permanecen intactos. La petición del usuario autoriza completar la implementación por hitos, verificando cada uno antes de avanzar. La interacción real de H3 requiere la clave que el usuario incorporará al terminar; esa aceptación no se sustituye por pruebas simuladas.

## Decisiones de alcance

- Node.js 24, TypeScript ESM estricto, tres agentes `createAgent`, sin supervisor ni frontend.
- El usuario autorizó usar material genérico mientras aporta el definitivo. `src/academic/corpus.ts` contiene el corpus fijo, contrastado con https://scrumguides.org/scrum-guide.html (Guía 2020). No se considera aprobado por el PO.
- AI SDK no es una dependencia. Su configuración y resultados solo se necesitan para una comparación futura; se registran modelo, parámetros y hash del corpus para poder reproducirla.
- RP10 es opcional y queda fuera de esta entrega; no se simula una evaluación pedagógica con otro LLM.
- En Windows se usa `npm.cmd` porque PowerShell bloquea `npm.ps1`; no se modifica la política del sistema.

## H1 — Base y contratos

Archivos: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/domain/contracts.ts`, `src/academic/corpus.ts`, `src/fixtures/scenarios.ts`, `src/tests/contracts.test.ts`.

Validación ejecutada: instalación con lockfile, `npm.cmd run typecheck`, `npm.cmd test`. Q01/Q02/Q03 conservan sus claves B/C/B. Los fixtures se construyen como copias independientes. Las respuestas públicas se construyen por lista blanca.

Resultado H1: `typecheck` y 3 pruebas aprobadas. Dependencias fijadas con lockfile. tsx requiere ejecutar fuera del sandbox de esta sesión por un error de consulta de usuario de Windows; funciona normalmente en la terminal local.

## H2 — Agentes y grafo sin red

Archivos: `src/agents/*`, `src/graph/*`, `src/config/limits.ts`, `src/domain/policy.ts`, `src/domain/errors.ts`, `src/infrastructure/{memory-store,metrics}.ts`, doble de modelo y pruebas del grafo.

Resultado: `typecheck` y 8 pruebas aprobadas. Tres `createAgent` reales con herramientas separadas. `Command.PARENT` probado con la versión instalada. La ruta alternativa Analista → Diagnosticador → Analista → Tutor ejecuta 4 activaciones, 3 handoffs y 5 llamadas simuladas. El ciclo excedido aborta. Las claves y las reglas prevalecen sobre el modelo.

La instrumentación mínima nació en H2 porque el presupuesto debe medirse en llamadas, no en activaciones; H5 agrega exportación y evaluación. Cada agente recibe contexto estructurado específico; el par AIMessage/ToolMessage del handoff se conserva en el estado temporal sin reenviar toda la conversación.

## H3 — Claude y salidas estructuradas

Archivos: `src/config/{env,model}.ts`, `src/tests/anthropic.test.ts`. Modelo predeterminado `claude-sonnet-4-6`, configurable. Sonnet 4.5 está deprecado según https://platform.claude.com/docs/en/about-claude/model-deprecations; se evita fijarlo como valor inicial.

Se usa ChatAnthropic compartido por los tres agentes, sin temperatura explícita ni reintentos ocultos. La entrega se realiza por herramientas Zod, sin `responseFormat` que compita con handoffs.

Aceptación real pendiente: una llamada completa a Anthropic requiere la clave del usuario. La prueba con HTTP simulado verifica serialización, herramientas y uso de los tres agentes, pero no demuestra comportamiento de Claude ni calidad pedagógica.

Resultado H3 sin red: `typecheck` y 10 pruebas aprobadas. El adaptador ChatAnthropic ejecuta cuatro solicitudes HTTP simuladas para E1; registra 400 tokens de entrada y 120 de salida una sola vez. No hubo consumo de API.

## H4 — Turno completo y escenarios

Archivos: `src/services/turn-coordinator.ts`, `src/cli/*`, `src/tests/coordinator.test.ts`; ampliación de fixtures simulados.

Resultado: `npm.cmd run typecheck`, 17 pruebas y `npm.cmd run scenarios -- --mock` aprobados. E1–E5 parten de snapshots limpios; el chequeo START ofrece tres temas. El coordinador reconcilia la clave, valida estrategia/salida y hace una única escritura con versión. Error, entrada inválida o fuga explícita no modifican la sesión. REQUEST_HINT no suma errores. Los errores se muestran con códigos sin cuerpos crudos del proveedor.

## H5 — Métricas y evaluación

Archivos: `src/infrastructure/reports.ts`, callbacks de métricas, `src/tests/limits-metrics.test.ts`, `README.md`, `outputs/examples/*`; integración de exportación en ambas CLI.

Resultado: `typecheck` y 24 pruebas aprobadas, más E1–E5/START en modo simulado. Cinco reportes JSON, resumen, trazas y rúbrica vacía disponibles en `outputs/examples`. Llamadas reales en esos reportes: cero. Las respuestas programadas no prueban calidad pedagógica. El runner real genera los mismos artefactos tras añadir la clave.

Comprobación final de consola: `npm.cmd run dev` con clave deliberadamente vacía termina con código 1 y explica que debe configurarse `ANTHROPIC_API_KEY`, sin llamar al proveedor. La prueba HTTP 429 confirma exactamente dos solicitudes simuladas, cero reintentos ocultos y cero cambios en la sesión.

## Incidentes y límites comprobados

- Instalación npm necesitó acceso al registro fuera del sandbox. No se cambió la política de PowerShell. El lockfile fija versiones y `npm install` reportó cero vulnerabilidades.
- TypeScript instalado exige declarar `types: ["node"]`; corregido y verificado.
- Una prueba de presupuesto detectó antes el rechazo de justificación repetida; se separó el caso de límite usando una razón distinta. La guarda de ciclo se mantiene.
- La guía permite una reevaluación desde ANSWER, pero llegar después al Tutor requeriría cinco activaciones. Se mantienen sus límites innegociables (4/3/6). El intento excedido aborta sin commit; esta discrepancia queda visible, sin aumentar silenciosamente el presupuesto.
- La ruta Analista → Diagnosticador → Analista → Tutor se prueba con entrada directa al grafo. No se presenta como una ruta exitosa del coordinador público en ANSWER. La ruta de aclaración Analista → Tutor → Analista → Tutor sí se prueba por REQUEST_HINT.
- Timeout, límite de seis llamadas y reintento global están probados. Tokens ausentes quedan null por llamada; callbacks repetidos no duplican uso.
- Las reglas estructurales no garantizan fidelidad, utilidad de pistas, distractores plausibles, transferencia genuina ni ausencia de revelaciones por paráfrasis. Esas propiedades se revisan con la rúbrica manual.
- El corpus autorizado es genérico y provisional. La configuración AI SDK y la comparación entre arquitecturas no son requisitos para usar esta implementación.

## Pendiente del usuario

Completar `ANTHROPIC_API_KEY` en `.env`, ejecutar `npm.cmd run scenarios -- E1` para aceptación real de H3, luego `npm.cmd run scenarios` y revisar la rúbrica. El material definitivo puede incorporarse después. No se afirma que H3 real esté aprobado ni que esta arquitectura supere a otra.
