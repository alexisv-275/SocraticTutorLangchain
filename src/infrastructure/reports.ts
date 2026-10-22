import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TurnResult } from '../services/turn-coordinator.js';
import { scenarioIds, type ScenarioId } from '../fixtures/scenarios.js';

const checks: Record<ScenarioId, string[]> = {
  E1: ['Identifica acierto', 'No declara VERIFIED', 'Plantea comprobación de transferencia'],
  E2: ['Contabiliza un error', 'Ofrece pista útil sin revelar clave', 'Permite reintento coherente'],
  E3: ['Reconoce segundo error', 'Explica brevemente y reduce dificultad real', 'Comprueba de nuevo sin declarar dominio'],
  E4: ['Reconoce error en transferencia', 'Conserva comprensión no verificada', 'Ofrece refuerzo pertinente'],
  E5: ['Cambia al tema solicitado', 'Reinicia estado activo sin contaminación', 'Conserva historial del tema previo'],
};
export function blankRubric() {
  return { evaluation: 'MANUAL', passedChecks: null, applicableChecks: 15, compliancePercent: null,
    criticalFailures: null, notes: '', cases: scenarioIds.map(scenarioId => ({ scenarioId,
      checks: checks[scenarioId].map(description => ({ description, passed: null, evidence: '' })),
      criticalFailures: null, notes: '',
    })) };
}
export async function createRunDirectory(mode: 'live' | 'mock', purpose = 'scenarios') {
  const directory = join('outputs', 'runs', `${mode}-${purpose}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  return directory;
}
export async function writeReport(directory: string, filename: string, report: TurnResult['report']) {
  await writeFile(join(directory, `${filename}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
}
export async function writeRunSummary(directory: string, reports: TurnResult['report'][]) {
  await writeFile(join(directory, 'rubric.json'), JSON.stringify(blankRubric(), null, 2) + '\n', 'utf8');
  const handoffs = reports.flatMap(r => r.handoffs.map(h => ({ runId: r.runId, scenarioId: r.scenarioId, ...h })));
  await writeFile(join(directory, 'handoffs.json'), JSON.stringify(handoffs, null, 2) + '\n', 'utf8');
  const routes = reports.map(r => ({ scenarioId: r.scenarioId, status: r.status, route: r.agentTrace.map(t => t.role), error: r.error }));
  const allAnswersLinear = reports.filter(r => ['E1', 'E2', 'E3', 'E4'].includes(r.scenarioId ?? '')).every(r =>
    r.agentTrace.map(t => t.role).join(',') === 'diagnostic_agent,analyst_agent,tutor_agent');
  await writeFile(join(directory, 'summary.json'), JSON.stringify({
    mode: reports[0]?.mode, runs: routes, rubricStatus: 'PENDING_MANUAL_REVIEW',
    autonomyObservation: reports[0]?.mode === 'mock' ? 'Simulación programada; no permite evaluar autonomía de Claude.'
      : allAnswersLinear ? 'En las respuestas medidas no se observó una ruta alternativa ni valor de autonomía demostrado.'
        : 'Se observaron rutas distintas; revisar manualmente si aportan valor pedagógico.',
    failedRuns: reports.filter(r => r.status !== 'ok').length,
  }, null, 2) + '\n', 'utf8');
}
