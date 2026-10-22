import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { topics } from '../academic/corpus.js';
import type { PublicTurnResponse, StudentAction } from '../domain/contracts.js';
import { createRuntime } from './runtime.js';
import { createRunDirectory, writeReport } from '../infrastructure/reports.js';

function display(response: PublicTurnResponse) {
  console.log(`\n${response.message}`);
  if (response.question) {
    console.log(response.question.text);
    for (const [id, text] of Object.entries(response.question.options)) console.log(`${id}. ${text}`);
  }
  for (const action of response.actions) console.log(`${action.id}. ${action.label}`);
}
async function main() {
  const tutor = createRuntime(false);
  const directory = await createRunDirectory('live', 'demo');
  const rl = createInterface({ input: stdin, output: stdout });
  console.log('ThinkAgora · Tutor socrático de Scrum. Escribe salir para terminar.');
  try {
    let turn = await tutor.startSession();
    await writeReport(directory, turn.report.runId, turn.report);
    display(turn.response);
    if (turn.report.status !== 'ok') { console.error(`Código: ${turn.report.error?.code}`); process.exitCode = 1; return; }
    let choosingTopic = true;
    while (true) {
      if (choosingTopic) topics.forEach((t, i) => console.log(`${i + 1}. ${t.title}`));
      const raw = (await rl.question(choosingTopic ? '\nTema (1–3): ' : '\nRespuesta (A/B/C/4/5): ')).trim();
      if (raw.toLowerCase() === 'salir') break;
      let action: StudentAction | unknown;
      if (choosingTopic) {
        const topic = /^[1-3]$/.test(raw) ? topics[Number(raw) - 1] : undefined;
        if (!topic) { console.log('Selecciona 1, 2 o 3.'); continue; }
        action = { action: 'CHANGE_TOPIC', targetTopicId: topic.id };
      } else if (raw === '5') { choosingTopic = true; continue; }
      else if (raw === '4') action = { action: 'REQUEST_HINT', questionId: turn.response.question?.id };
      else action = { action: 'ANSWER', questionId: turn.response.question?.id, selectedOptionId: raw.toUpperCase() };
      turn = await tutor.handleTurn(turn.sessionId, action);
      await writeReport(directory, turn.report.runId, turn.report);
      display(turn.response);
      if (turn.report.status === 'ok') choosingTopic = !turn.response.question;
      if (turn.report.status === 'error') console.error(`Código: ${turn.report.error?.code}`);
    }
  } finally { rl.close(); console.log(`Reportes: ${directory}`); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'No se pudo iniciar.'); process.exitCode = 1; });
