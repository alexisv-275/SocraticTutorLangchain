import { createHash } from 'node:crypto';

// Conserva IDs de fixtures y asocia cada tema con secciones del material editable.
export function parseMaterial(markdown: string) {
  const sections = new Map<string, string>();
  let heading = '';
  for (const line of markdown.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n').split('\n')) {
    const match = /^##\s+(\d+)\.\s+(.+)$/u.exec(line);
    if (match) {
      heading = match[1]!;
      if (sections.has(heading)) throw new Error(`scrum.md: sección ${heading} duplicada.`);
      sections.set(heading, line + '\n');
    } else if (heading) sections.set(heading, sections.get(heading)! + line + '\n');
  }
  for (const id of ['1', '2', '3', '4', '5']) {
    if (!sections.get(id)?.split('\n').slice(1).join('\n').trim()) {
      throw new Error(`scrum.md: falta contenido en la sección ## ${id}.`);
    }
  }
  const text = (...ids: string[]) => ids.map(id => sections.get(id)!.trim()).join('\n\n');
  return {
    id: 'scrum-material-v1', status: 'USER_SUPPLIED', source: 'scrum.md',
    sourceHash: createHash('sha256').update(markdown).digest('hex'),
    sections: [
      { id: 'scrum-roles', title: 'Responsabilidades en Scrum', concepts: ['product-owner', 'scrum-master', 'developers'], text: text('1', '2', '5') },
      { id: 'scrum-events', title: 'Eventos de Scrum', concepts: ['sprint', 'sprint-planning', 'daily-scrum', 'sprint-review', 'sprint-retrospective'], text: text('1', '3', '5') },
      { id: 'scrum-backlog', title: 'Artefactos y compromisos', concepts: ['backlog-ordering', 'product-goal', 'sprint-backlog', 'sprint-goal', 'increment', 'definition-of-done'], text: text('1', '4', '5') },
    ],
  };
}
