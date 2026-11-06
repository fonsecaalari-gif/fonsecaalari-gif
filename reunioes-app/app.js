(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    btnRecord: $('btn-record'),
    timer: $('timer'),
    statusDot: $('status-dot'),
    statusText: $('status-text'),
    lang: $('lang'),
    live: $('live-transcript'),
    interim: $('interim-text'),
    sumList: $('sum-list'),
    topicList: $('topic-list'),
    actionList: $('action-list'),
    btnCopy: $('btn-copy'),
    btnMd: $('btn-md'),
    btnShare: $('btn-share'),
    list: $('meetings-list'),
    warn: $('sr-warning'),
  };

  const PT_STOP = ('a o os as um uma de do da dos das em no na nos nas por para com sem sob sobre entre ate apos desde que e ou mas porque pois se como quando onde quanto quem qual quais isto isso esse essa este esta ele ela eles elas eu voce voces nos seu sua seus suas meu minha meus minhas nosso nossa nossos nossas ja ainda tambem nao sim mais menos muito muita muitos muitas todo todos toda todas cada outro outros outra outras e sao foi eram era esta estao ser estar ter tem vamos vai vou').split(' ');
  const EN_STOP = ('the a an and or but if then else of at by for with about to from in on is are was were be been being it its this that these those i you he she we they them his her their our your my as not no do does did done will would can could should may might must shall let us say said get got make made go going know think see want use find give tell work call try ask need feel become leave put mean keep begin seem help talk turn start show hear play run move like live believe hold bring happen write sit stand lose pay meet include continue set learn change lead understand watch follow stop create speak read allow add spend grow open walk win offer remember consider appear buy wait serve die send expect build stay fall cut reach kill remain suggest raise pass sell require report decide pull').split(' ');
  const STOPWORDS = new Set([...PT_STOP, ...EN_STOP]);

  const ACTION_RE = /\b(vou|precis\w*|temos que|tem que|tarefa|entreg\w*|envi\w*|agend\w*|marc\w*|revis\w*|prepar\w*|test\w*|implement\w*|responsavel|prazo|deadline|follow[- ]?up|action items?|to[- ]?do|todo|will|need to|have to|must|should|due|assign\w*|owner|next steps?)\b|\bate\s+(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/i;

  let recorder = null;
  let stream = null;
  let recognition = null;
  let recording = false;
  let chunks = [];
  let segments = [];
  let startTs = 0;
  let timerId = null;
  let notesTimer = null;
  let currentNotes = { resumo: [], topicos: [], acoes: [] };
  let currentTranscript = '';
  let player = null;
  let playingId = null;

  const DB_NAME = 'notas-reuniao';
  const STORE = 'reunioes';
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbPut(rec) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const tokenize = (text) => text.toLowerCase().match(/[a-zà-ÿ0-9]+/gi) || [];
  function splitSentences(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const m = t.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g);
    return m ? m.map((s) => s.trim()).filter(Boolean) : [t];
  }
  function summarize(text) {
    const sents = splitSentences(text);
    if (!sents.length) return [];
    const freq = {};
    for (const w of tokenize(text)) if (w.length > 3 && !STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    const scored = sents.map((s, i) => {
      const ws = tokenize(s);
      const sc = ws.reduce((a, w) => a + (freq[w] || 0), 0) / (Math.sqrt(ws.length) || 1);
      return { s, i, sc };
    });
    const k = Math.max(1, Math.min(5, Math.round(sents.length / 3)));
    return scored.sort((a, b) => b.sc - a.sc).slice(0, k).sort((a, b) => a.i - b.i).map((o) => o.s);
  }
  function extractTopics(text) {
    const freq = {};
    for (const w of tokenize(text)) if (w.length > 4 && !STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([w]) => w[0].toUpperCase() + w.slice(1));
  }
  function extractActions(text) {
    return splitSentences(text)
      .filter((s) => ACTION_RE.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '')))
      .slice(0, 10);
  }

  function fmtTime(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setRecordingUI(on) {
    els.btnRecord.classList.toggle('recording', on);
    els.btnRecord.setAttribute('aria-label', on ? 'Parar gravação' : 'Iniciar gravação');
    els.statusDot.classList.toggle('on', on);
    els.statusText.textContent = on ? 'Gravando…' : 'Gravação encerrada';
    els.lang.disabled = on;
  }
  function renderTranscript() {
    if (!segments.length) {
      els.live.innerHTML = '<p class="placeholder">A transcrição aparece aqui enquanto você fala…</p>';
    } else {
      els.live.innerHTML = segments.map((s) => `<p>${escapeHtml(s)}</p>`).join('');
    }
    els.live.scrollTop = els.live.scrollHeight;
  }
  function fillList(ul, items, placeholder) {
    ul.innerHTML = items.length
      ? items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')
      : `<li class="placeholder">${placeholder}</li>`;
  }
  function renderNotes() {
    currentTranscript = segments.join(' ').replace(/\s+/g, ' ').trim();
    currentNotes = {
      resumo: summarize(currentTranscript),
      topicos: extractTopics(currentTranscript),
      acoes: extractActions(currentTranscript),
    };
    fillList(els.sumList, currentNotes.resumo, 'Ainda sem conteúdo para resumir.');
    fillList(els.topicList, currentNotes.topicos, 'Os principais assuntos aparecem aqui.');
    fillList(els.actionList, currentNotes.acoes, 'Nenhum item de ação identificado ainda.');
  }
  function scheduleNotes() {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(renderNotes, 700);
  }

  function pickMime() {
    if (!window.MediaRecorder) return '';
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return cands.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }
  async function startRecording() {
    if (recording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Este navegador não permite acesso ao microfone.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      alert('Não foi possível acessar o microfone. Verifique a permissão do site nas configurações do navegador.');
      return;
    }
    chunks = [];
    segments = [];
    const mime = pickMime();
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) {
      recorder = new MediaRecorder(stream);
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = onRecordingStopped;
    recorder.start(1000);
    recognition = startRecognition(els.lang.value);
    recording = true;
    startTs = Date.now();
    setRecordingUI(true);
    renderTranscript();
    renderNotes();
    timerId = setInterval(() => {
      els.timer.textContent = fmtTime(Math.floor((Date.now() - startTs) / 1000));
    }, 500);
  }
  function stopRecording() {
    if (!recording) return;
    recording = false;
    clearInterval(timerId);
    if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    setRecordingUI(false);
    els.timer.textContent = fmtTime(Math.max(0, Math.floor((Date.now() - startTs) / 1000)));
  }
  async function onRecordingStopped() {
    const mime = recorder && recorder.mimeType ? recorder.mimeType : 'audio/webm';
    const blob = new Blob(chunks, { type: mime });
    chunks = [];
    const transcript = segments.join(' ').replace(/\s+/g, ' ').trim();
    const notes = {
      resumo: summarize(transcript),
      topicos: extractTopics(transcript),
      acoes: extractActions(transcript),
    };
    renderNotes();
    const rec = {
      title: makeTitle(transcript),
      createdAt: new Date().toISOString(),
      durationSec: Math.max(1, Math.round((Date.now() - startTs) / 1000)),
      lang: els.lang.value,
      transcript,
      notes,
      audio: blob,
      mime,
    };
    try { await dbPut(rec); } catch (_) {}
    await renderList();
  }
  function makeTitle(transcript) {
    if (transcript) {
      const words = transcript.split(' ').slice(0, 6).join(' ');
      return words.length > 40 ? words.slice(0, 40) + '…' : words;
    }
    return 'Reunião de ' + new Date().toLocaleDateString('pt-BR');
  }

  function startRecognition(lang) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { els.warn.hidden = false; return null; }
    els.warn.hidden = true;
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) segments.push(t.trim());
        else interim += t;
      }
      els.interim.textContent = interim.trim();
      renderTranscript();
      scheduleNotes();
    };
    r.onerror = () => {};
    r.onend = () => { if (recording) { try { r.start(); } catch (_) {} } };
    try { r.start(); } catch (_) {}
    return r;
  }

  async function renderList() {
    let items = [];
    try { items = await dbAll(); } catch (_) {}
    items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (!items.length) {
      els.list.innerHTML = '<p class="placeholder">Nenhuma reunião salva ainda.</p>';
      return;
    }
    els.list.innerHTML = '';
    for (const rec of items) {
      const card = document.createElement('div');
      card.className = 'meeting';
      const date = new Date(rec.createdAt).toLocaleString('pt-BR');
      const playLabel = playingId === rec.id ? '⏸ Pausar' : '▶ Ouvir';
      card.innerHTML = `
        <div class="meeting-info">
          <strong>${escapeHtml(rec.title || 'Reunião')}</strong>
          <span>${escapeHtml(date)} · ${fmtTime(rec.durationSec || 0)}</span>
        </div>
        <div class="meeting-actions">
          <button class="chip" data-act="play" data-id="${rec.id}">${playLabel}</button>
          <button class="chip" data-act="audio" data-id="${rec.id}">Áudio</button>
          <button class="chip" data-act="md" data-id="${rec.id}">.md</button>
          <button class="chip" data-act="copy" data-id="${rec.id}">Copiar</button>
          <button class="chip danger" data-act="del" data-id="${rec.id}">Excluir</button>
        </div>`;
      els.list.appendChild(card);
    }
  }
  function toMarkdown(rec) {
    const resumo = rec.notes && rec.notes.resumo.length ? rec.notes.resumo : ['- (sem transcrição)'];
    const topicos = rec.notes && rec.notes.topicos.length ? rec.notes.topicos : ['-'];
    const acoes = rec.notes && rec.notes.acoes.length ? rec.notes.acoes : ['- Nenhum identificado'];
    return [
      `# ${rec.title || 'Reunião'}`,
      '',
      `Data: ${new Date(rec.createdAt).toLocaleString('pt-BR')} · Duração: ${fmtTime(rec.durationSec || 0)} · Idioma: ${rec.lang || 'pt-BR'}`,
      '',
      '## Resumo',
      ...resumo.map((s) => `- ${s}`),
      '',
      '## Tópicos',
      ...topicos.map((t) => `- ${t}`),
      '',
      '## Itens de ação',
      ...acoes.map((a) => `- [ ] ${a}`),
      '',
      '## Transcrição completa',
      rec.transcript || '(sem transcrição)',
      '',
    ].join('\n');
  }
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      flash('Copiado para a área de transferência!');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flash('Copiado para a área de transferência!'); }
      catch (e) { flash('Não foi possível copiar.'); }
      ta.remove();
    }
  }
  let flashTimer = null;
  function flash(msg) {
    els.statusText.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (!recording) els.statusText.textContent = 'Pronto para gravar'; }, 2200);
  }
  function slug(t) {
    return String(t || 'reuniao').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 40) || 'reuniao';
  }
  function currentMarkdown() {
    return toMarkdown({
      title: makeTitle(currentTranscript),
      createdAt: new Date(startTs || Date.now()).toISOString(),
      durationSec: Math.max(0, Math.round((Date.now() - startTs) / 1000)),
      lang: els.lang.value,
      transcript: currentTranscript,
      notes: currentNotes,
    });
  }
  async function handleListAction(act, id) {
    const items = await dbAll();
    const rec = items.find((r) => r.id === Number(id));
    if (!rec) return;
    if (act === 'del') { await dbDelete(rec.id); playingId = null; await renderList(); return; }
    if (act === 'play') { togglePlay(rec); return; }
    if (act === 'audio' && rec.audio) { download(`${slug(rec.title)}-audio.webm`, rec.audio); return; }
    if (act === 'md') { download(`${slug(rec.title)}.md`, new Blob([toMarkdown(rec)], { type: 'text/markdown;charset=utf-8' })); return; }
    if (act === 'copy') { await copyText(toMarkdown(rec)); return; }
  }
  function togglePlay(rec) {
    if (!rec.audio) return;
    if (playingId === rec.id && player && !player.paused) {
      player.pause();
      playingId = null;
      renderList();
      return;
    }
    if (player) player.pause();
    player = new Audio(URL.createObjectURL(rec.audio));
    playingId = rec.id;
    player.onended = () => { playingId = null; renderList(); };
    player.play().catch(() => {});
    renderList();
  }

  function toggle() { recording ? stopRecording() : startRecording(); }
  els.btnRecord.addEventListener('click', toggle);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); toggle(); }
  });
  els.btnCopy.addEventListener('click', () => copyText(currentMarkdown()));
  els.btnMd.addEventListener('click', () => {
    download(`${slug(makeTitle(currentTranscript))}.md`, new Blob([currentMarkdown()], { type: 'text/markdown;charset=utf-8' }));
  });
  els.btnShare.addEventListener('click', async () => {
    const md = currentMarkdown();
    if (navigator.share) {
      try { await navigator.share({ title: 'Notas de reunião', text: md }); } catch (_) {}
    } else {
      await copyText(md);
    }
  });
  els.list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn) handleListAction(btn.dataset.act, btn.dataset.id);
  });

  renderTranscript();
  renderNotes();
  renderList();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
