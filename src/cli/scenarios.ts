import { scenario, scenarioIds } from '../fixtures/scenarios.js';
import { createRuntime } from './runtime.js';
import { createRunDirectory, writeReport, writeRunSummary } from '../infrastructure/reports.js';
import type { TurnResult } from '../services/turn-coordinator.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--mock' && !/^E[1-5]$/.test(a))) throw new Error('Uso: npm run scenarios -- [--mock] [E1|E2|E3|E4|E5]');
  const mock = args.includes('--mock');
  const selected = args.find(a => /^E[1-5]$/.test(a));
  const tutor = createRuntime(mock);
  const directory = await createRunDirectory(mock ? 'mock' : 'live');
  const reports: TurnResult['report'][] = [];
  let failed = false;
  for (const id of selected ? scenarioIds.filter(s => s === selected) : scenarioIds) {
    const fixture = scenario(id);
    tutor.store.reset(fixture.session);
    const turn = await tutor.handleTurn(fixture.session.sessionId, fixture.action, id);
    reports.push(turn.report);
    await writeReport(directory, id, turn.report);
    console.log(`${id}: ${turn.report.status}; estrategia=${turn.report.strategy}; llamadas Claude=${turn.report.llmCalls}; simuladas=${turn.report.simulatedModelCalls}`);
    if (turn.report.status !== 'ok') failed = true;
  }
  if (!selected) {
    const start = await tutor.startSession();
    reports.push(start.report);
    await writeReport(directory, 'START', start.report);
    if (start.report.status !== 'ok') failed = true;
  }
  await writeRunSummary(directory, reports);
  console.log(`Reportes: ${directory}`);
  if (mock) console.log('Simulación sin API: estos resultados no evalúan a Claude ni su calidad pedagógica.');
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'No se pudo iniciar.'); process.exitCode = 1; });
