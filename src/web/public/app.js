const ui = Object.fromEntries([
  'progress', 'progress-text', 'focus', 'question-heading', 'source-reference',
  'answer-heading', 'intro', 'status', 'error', 'options', 'feedback', 'previous', 'primary',
  'topic-field', 'practice-topic', 'practice-file', 'source-title',
].map(id => [id, document.getElementById(id)]));

const turns = [];
let sessionId;
let index = 0;
let selected;
let busy = false;
let failure = '';
let pendingUpload;
let progressMessage = '';

function render() {
  const turn = turns[index];
  ui.error.hidden = !failure;
  ui.error.textContent = failure;
  ui.status.hidden = !busy;
  ui.status.textContent = progressMessage;
  ui.intro.hidden = Boolean(turn || busy);
  ui['topic-field'].hidden = Boolean(turn && !turn.review?.finished);
  ui['practice-topic'].disabled = busy;
  ui['practice-file'].disabled = busy;
  const topic = ui['practice-topic'].value.trim();
  const hasFile = Boolean(ui['practice-file'].files.length);
  ui['source-title'].textContent = turn?.topic ?? (topic || 'Material de estudio');
  ui.options.hidden = !turn;
  ui.progress.hidden = !turn;
  ui['source-reference'].hidden = !turn?.review;
  ui.feedback.hidden = !turn?.review;
  ui.previous.hidden = !turn;
  ui.previous.disabled = busy || index === 0;
  ui.primary.disabled = busy || (!turn || turn.review?.finished ? !topic && !hasFile : !turn.review && !selected);
  ui.primary.textContent = !turn || turn.review?.finished ? 'Start' : turn.review ? 'Siguiente' : 'Responder';
  ui['answer-heading'].textContent = turn ? 'Elige tu respuesta' : 'Práctica de Fundamentos';

  if (!turn) {
    ui.focus.textContent = 'Reconoce la situación, explica la idea inicial y detecta supuestos básicos.';
    ui['question-heading'].textContent = 'Empieza por la primera idea.';
    return;
  }

  ui.focus.textContent = `${turn.focus} · ${turn.topic}`;
  ui['question-heading'].textContent = turn.question.text;
  ui['progress-text'].textContent = `Pregunta ${turn.number} de ${turn.total}`;
  const bars = Array.from({ length: turn.total }, (_, position) => {
    const bar = document.createElement('span');
    bar.classList.toggle('filled', position < turn.number);
    return bar;
  });
  ui.progress.querySelector('.progress-bars').replaceChildren(...bars);
  ui.options.replaceChildren(...Object.entries(turn.question.options).map(([option, text]) => {
    const button = document.createElement('button');
    button.className = 'option';
    button.type = 'button';
    button.disabled = busy || Boolean(turn.review);
    button.setAttribute('aria-pressed', String((turn.review?.selected ?? selected) === option));
    const letter = document.createElement('span');
    letter.className = 'letter';
    letter.textContent = option;
    const content = document.createElement('span');
    content.className = 'option-text';
    content.textContent = text;
    button.append(letter, content);
    button.addEventListener('click', () => {
      selected = option;
      for (const item of ui.options.children) item.setAttribute('aria-pressed', String(item === button));
      ui.primary.disabled = false;
    });
    return button;
  }));
  if (turn.review) {
    const label = turn.review.correct ? 'Acertaste.' : 'Revisa la idea.';
    const finished = turn.review.finished ? ' · Práctica completa' : '';
    ui.feedback.textContent = `${label} ${turn.review.feedback}${finished}`;
    const sources = turn.sources.map(({ source, headings }) => `${source.split('/').at(-1)} · ${headings.join(', ')}`);
    ui['source-reference'].textContent = `Fragmentos consultados · ${sources.join(' | ')}`;
  }
}

async function responseData(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
  return data;
}

async function post(path, body) {
  return responseData(await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

function showProgress(message) {
  progressMessage = message;
  render();
}

async function startFromForm() {
  const file = ui['practice-file'].files[0];
  const topic = ui['practice-topic'].value.trim();
  if (!file) {
    showProgress('Buscando en la biblioteca y preparando la primera pregunta…');
    return post('/api/start', { topic });
  }

  if (!pendingUpload) {
    showProgress('Subiendo el archivo a Supabase…');
    const query = new URLSearchParams({ filename: file.name });
    pendingUpload = await responseData(await fetch(`/api/material?${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    }));
  }

  const { uploadId } = pendingUpload;
  showProgress('Archivo guardado. Esperando a que n8n lo indexe…');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { indexed } = await post('/api/material/status', { uploadId });
    if (indexed) {
      showProgress('Material indexado. Preparando la primera pregunta…');
      return post('/api/start', { uploadId, ...(topic && { topic }) });
    }
    await new Promise(resolve => setTimeout(resolve, 1800));
  }
  throw new Error('El archivo ya está en Supabase. Pulsa Start para volver a comprobar si terminó de indexarse. Si sigue pendiente, revisa n8n y el túnel.');
}

ui.primary.addEventListener('click', async () => {
  if (busy) return;
  const turn = turns[index];
  failure = '';
  if (turn?.review && !turn.review.finished) {
    index += 1;
    selected = undefined;
    render();
    ui['question-heading'].focus();
    return;
  }

  busy = true;
  try {
    if (!turn || turn.review?.finished) {
      const result = await startFromForm();
      pendingUpload = undefined;
      ui['practice-file'].value = '';
      sessionId = result.sessionId;
      turns.splice(0, turns.length, result.turn);
      index = 0;
      selected = undefined;
    } else {
      showProgress('El tutor está revisando tu respuesta…');
      const result = await post('/api/answer', { sessionId, questionId: turn.question.id, option: selected });
      turn.review = { ...result, selected, finished: !result.next };
      if (result.next) turns.push(result.next);
    }
  } catch (error) {
    failure = error.message;
  } finally {
    busy = false;
    progressMessage = '';
    render();
    if (!failure) ui['question-heading'].focus();
  }
});

ui.previous.addEventListener('click', () => {
  if (busy || index === 0) return;
  index -= 1;
  selected = undefined;
  failure = '';
  render();
  ui['question-heading'].focus();
});

ui['practice-topic'].addEventListener('input', render);
ui['practice-file'].addEventListener('change', () => {
  pendingUpload = undefined;
  failure = '';
  const file = ui['practice-file'].files[0];
  if (file) ui['practice-topic'].value = file.name.replace(/\.(pdf|md)$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 160);
  render();
});
render();
