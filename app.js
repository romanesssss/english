(() => {
  'use strict';
  const source = window.VERBS;
  if (!Array.isArray(source) || source.length !== 200) {
    document.querySelector('main').textContent = 'Не удалось загрузить словарь. Обновите страницу.';
    return;
  }

  const $ = selector => document.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const DAY = 86400000;
  const intervals = [0, 1, 3, 7, 14, 30, 60];
  const CUSTOM_KEY = 'forms-custom-words-v1';
  const PROGRESS_KEY = 'forms-progress-v2';
  const OLD_PROGRESS_KEY = 'forms-200-progress-v1';
  const modals = new Set(['can', 'may', 'shall', 'will']);
  const starterWords = ['be','have','do','go','get','make','say','see','come','know','think','take','give','find','tell','become','show','leave','feel','put','bring','begin','keep','write','read','speak','eat','drink','run','buy','teach','understand','meet','send','build','break','choose','drive','fall','forget','grow','hear','hold','lose','pay','sell','sit','sleep','stand','swim','win'];
  const rank = new Map(starterWords.map((word, index) => [word, index]));
  const preset = source.map(verb => ({...verb, key:`v:${verb.id}`, type:'verb', custom:false}));

  function readJSON(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
    catch (_) { return fallback; }
  }
  function validCustom(word) {
    return word && typeof word.key === 'string' && word.key.startsWith('c:') && ['verb','noun'].includes(word.type)
      && typeof word.base === 'string' && word.base.trim() && word.base.length <= 80
      && typeof word.translation === 'string' && word.translation.trim() && word.translation.length <= 160
      && (word.type === 'noun' || (typeof word.past === 'string' && word.past.trim() && typeof word.participle === 'string' && word.participle.trim()));
  }
  let custom = readJSON(CUSTOM_KEY, []);
  custom = Array.isArray(custom) ? custom.filter(validCustom).map(word => ({...word, custom:true})) : [];
  let progress = readJSON(PROGRESS_KEY, null);
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    const old = readJSON(OLD_PROGRESS_KEY, {});
    progress = {};
    if (old && typeof old === 'object' && !Array.isArray(old)) {
      for (const [id, value] of Object.entries(old)) if (/^\d+$/.test(id)) progress[`v:${id}`] = value;
    }
  }
  let words = [...preset, ...custom];
  let byKey = new Map(words.map(word => [word.key, word]));
  let mode = 'learn';
  let learnFilter = 'today';
  let learnType = 'all';
  let currentKey = null;
  let revealed = false;
  let reviewedThisRun = new Set();
  let quizScope = 'all';
  let quizDeck = [];
  let quizUsed = new Set();
  let quizIndex = 0;
  let quizCorrect = 0;
  let quizResult = null;

  function persist() {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
      $('.save-status').innerHTML = '<span class="save-dot"></span>Прогресс сохранён в браузере';
    } catch (_) { $('.save-status').textContent = 'Не удалось сохранить данные'; }
  }
  function rebuildWords() {
    words = [...preset, ...custom];
    byKey = new Map(words.map(word => [word.key, word]));
    renderStats();
    renderLearn();
    renderList();
  }
  function state(word) { return progress[word.key] || null; }
  function isNew(word) { return !state(word); }
  function isDue(word) { const value = state(word); return !!value && (!value.due || value.due <= Date.now()); }
  function isModal(word) { return !word.custom && modals.has(word.base); }
  function matchesType(word, type) { return type === 'all' || word.type === type; }
  function sortGroup(a, b) {
    const da = state(a)?.due ?? Infinity;
    const db = state(b)?.due ?? Infinity;
    if (da !== db) return da - db;
    const ra = rank.get(a.base) ?? (a.custom ? 1000 + (a.createdAt || 0) / 1e12 : 500 + a.id);
    const rb = rank.get(b.base) ?? (b.custom ? 1000 + (b.createdAt || 0) / 1e12 : 500 + b.id);
    return ra - rb;
  }
  function interleave(pool) {
    const groups = [pool.filter(w => w.type === 'verb' && !w.custom).sort(sortGroup), pool.filter(w => w.type === 'verb' && w.custom).sort(sortGroup), pool.filter(w => w.type === 'noun').sort(sortGroup)];
    const ordered = [];
    while (groups.some(group => group.length)) for (const group of groups) if (group.length) ordered.push(group.shift());
    return ordered;
  }
  function practiceOrder(pool) {
    const due = pool.filter(isDue);
    const fresh = pool.filter(isNew);
    const other = pool.filter(word => !isDue(word) && !isNew(word));
    return [...interleave(due), ...interleave(fresh), ...interleave(other)];
  }
  function review(word, remembered) {
    const old = state(word) || {box:0,correct:0,wrong:0};
    const box = remembered ? Math.min(6, (old.box || 0) + 1) : 0;
    progress[word.key] = {box,correct:(old.correct || 0) + Number(remembered),wrong:(old.wrong || 0) + Number(!remembered),due:Date.now() + intervals[box] * DAY,last:Date.now()};
    persist();
    renderStats();
    if (mode === 'list') renderList();
  }
  function renderStats() {
    const seen = words.filter(word => !isNew(word)).length;
    const due = words.filter(isDue).length;
    const mastered = words.filter(word => (state(word)?.box || 0) >= 2).length;
    const total = words.length;
    $('#stat-learned').textContent = seen;
    $('#stat-due').textContent = due;
    $('#stat-new').textContent = total - seen;
    const percent = Math.round(mastered / total * 100);
    $('#progress-percent').textContent = `${percent}%`;
    $('#progress-fill').style.width = `${percent}%`;
    $('#progress-caption').textContent = `Уверенно выучено ${mastered} из ${total} слов`;
  }
  function speak(word) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    speechSynthesis.speak(utterance);
  }
  function learnCandidates() {
    let pool = words.filter(word => matchesType(word, learnType));
    if (learnFilter === 'new') pool = pool.filter(isNew);
    else if (learnFilter === 'mistakes') pool = pool.filter(word => (state(word)?.wrong || 0) > 0);
    else pool = pool.filter(word => isNew(word) || isDue(word));
    return practiceOrder(pool).filter(word => !reviewedThisRun.has(word.key));
  }
  function renderLearn() {
    const pool = learnCandidates();
    let word = byKey.get(currentKey);
    if (!word || !pool.some(item => item.key === word.key)) {
      word = pool[0];
      currentKey = word?.key || null;
      revealed = false;
    }
    const container = $('#learn-content');
    if (!word) {
      const isNoNouns = learnType === 'noun' && !words.some(item => item.type === 'noun');
      const message = isNoNouns ? 'Вы ещё не добавили существительные.' : learnFilter === 'mistakes' ? 'Слов с ошибками пока нет.' : learnFilter === 'new' ? 'Новых слов в этой категории пока нет.' : 'На сегодня слова в этой категории закончились.';
      container.innerHTML = `<div class="empty-card"><div class="empty-icon">✦</div><h3>${isNoNouns ? 'Начните словарь' : 'Отличная работа'}</h3><p>${message}</p><button class="secondary-btn" id="empty-action" type="button">${isNoNouns ? 'Добавить существительное' : 'Начать ещё один подход'}</button></div>`;
      $('#empty-action').addEventListener('click', () => { if (isNoNouns) { switchMode('list'); openAdd('noun'); } else { reviewedThisRun.clear(); renderLearn(); } });
      return;
    }
    const noun = word.type === 'noun';
    const label = noun ? 'ПЕРЕВЕДИТЕ НА АНГЛИЙСКИЙ' : 'ВСПОМНИТЕ ФОРМЫ V2 И V3';
    const prompt = noun ? word.translation : word.base;
    const sub = noun ? 'Существительное' : word.translation;
    const answer = noun ? `<div class="card-form-grid one"><div class="card-form"><span>АНГЛИЙСКОЕ СЛОВО</span><strong>${escape(word.base)}</strong></div></div>` : `<div class="card-form-grid"><div class="card-form"><span>V2 · PAST SIMPLE</span><strong>${escape(word.past)}</strong></div><div class="card-form"><span>V3 · PAST PARTICIPLE</span>${isModal(word) ? '<small>Нет формы V3</small>' : `<strong>${escape(word.participle)}</strong>`}</div></div>${isModal(word) ? '<div class="card-modal">Модальный глагол: в исходном PDF V2 повторена в колонке V3.</div>' : ''}`;
    container.innerHTML = `<article class="flashcard" aria-label="Карточка: ${escape(prompt)}"><div class="card-top"><span>${label}</span><span class="card-number">${word.custom ? 'МОЁ СЛОВО' : `${word.id} / 200`}</span></div><div class="card-body"><div class="card-word ${noun ? 'noun-prompt' : ''}">${escape(prompt)}</div><div class="card-translation">${escape(sub)}</div></div>${revealed ? answer : '<div class="card-placeholder">Ответьте мысленно, затем откройте ответ ↓</div>'}${!noun || revealed ? '<button class="card-audio" id="say-card" type="button" aria-label="Произнести слово">◖))</button>' : ''}</article><div class="learn-actions">${revealed ? '<button class="secondary-btn" id="forgot" type="button">↺ &nbsp; Не помню</button><button class="primary-btn" id="remembered" type="button">Помню &nbsp; ↗</button>' : '<button class="primary-btn" id="reveal" type="button">Показать ответ &nbsp; ↗</button>'}</div>`;
    $('#say-card')?.addEventListener('click', () => speak(word.base));
    if (!revealed) $('#reveal').addEventListener('click', () => { revealed = true; renderLearn(); });
    else {
      $('#forgot').addEventListener('click', () => { review(word, false); reviewedThisRun.add(word.key); currentKey = null; renderLearn(); });
      $('#remembered').addEventListener('click', () => { review(word, true); reviewedThisRun.add(word.key); currentKey = null; renderLearn(); });
    }
  }
  function beginQuiz() {
    let pool = words.filter(word => matchesType(word, quizScope) && !quizUsed.has(word.key) && (isNew(word) || isDue(word)));
    if (!pool.length) pool = words.filter(word => matchesType(word, quizScope) && !quizUsed.has(word.key));
    if (!pool.length) { quizUsed.clear(); pool = words.filter(word => matchesType(word, quizScope)); }
    quizDeck = practiceOrder(pool).slice(0, 10);
    quizDeck.forEach(word => quizUsed.add(word.key));
    quizIndex = 0;
    quizCorrect = 0;
    quizResult = null;
    renderQuiz();
  }
  function normalize(answer, noun = false) {
    let value = answer.toLowerCase().trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
    if (noun) value = value.replace(/^(a|an|the)\s+/, '');
    return value;
  }
  function matches(answer, sourceAnswer, noun = false) {
    const value = normalize(answer, noun);
    return sourceAnswer.split(';').some(option => normalize(option, noun) === value);
  }
  function checkQuiz(dontKnow = false) {
    if (quizResult) return;
    const word = quizDeck[quizIndex];
    const noun = word.type === 'noun';
    const first = $('#quiz-first').value;
    const second = noun || isModal(word) ? '' : $('#quiz-second').value;
    if (!dontKnow && (!first.trim() || (!noun && !isModal(word) && !second.trim()))) {
      $('#quiz-hint').textContent = 'Заполните ответ или нажмите «Не знаю».';
      return;
    }
    const firstOk = !dontKnow && matches(first, noun ? word.base : word.past, noun);
    const secondOk = noun || isModal(word) || (!dontKnow && matches(second, word.participle));
    const correct = firstOk && secondOk;
    review(word, correct);
    if (correct) quizCorrect++;
    quizResult = {first, second, firstOk, secondOk, correct};
    renderQuiz();
  }
  function renderQuiz() {
    const container = $('#quiz-content');
    if (!quizDeck.length) {
      container.innerHTML = `<div class="empty-card"><div class="empty-icon">✦</div><h3>Пока нет слов</h3><p>Добавьте слово в эту категорию, чтобы начать проверку.</p><button class="primary-btn" id="quiz-add" type="button">Добавить слово</button></div>`;
      $('#quiz-add').addEventListener('click', () => { switchMode('list'); openAdd(quizScope === 'noun' ? 'noun' : 'verb'); });
      return;
    }
    if (quizIndex >= quizDeck.length) {
      container.innerHTML = `<div class="quiz-finish"><div class="empty-icon">✦</div><h3>${quizCorrect} из ${quizDeck.length} верно</h3><p>${quizCorrect === quizDeck.length ? 'Все ответы верны. Отличный подход!' : 'Слова с ошибками вернутся в повторение.'}</p><button class="primary-btn" id="quiz-again" type="button">Ещё один подход &nbsp; ↗</button></div>`;
      $('#quiz-again').addEventListener('click', beginQuiz);
      return;
    }
    const word = quizDeck[quizIndex];
    const noun = word.type === 'noun';
    const modal = isModal(word);
    const result = quizResult;
    const prompt = noun ? word.translation : word.base;
    const answer = noun ? word.base : `${word.base} — ${word.past} — ${modal ? 'V3 отсутствует' : word.participle}`;
    container.innerHTML = `<div class="quiz-panel"><div class="quiz-top"><span>СЛОВО ${quizIndex + 1} ИЗ ${quizDeck.length} · ${noun ? 'СУЩЕСТВИТЕЛЬНОЕ' : 'ГЛАГОЛ'}</span><span>${quizCorrect} верно</span></div><div class="quiz-track"><div style="width:${quizIndex / quizDeck.length * 100}%"></div></div><div class="quiz-word ${noun ? 'noun-quiz' : ''}">${escape(prompt)}</div><div class="quiz-translation">${noun ? 'Напишите английское слово' : escape(word.translation)}</div><form id="quiz-form" autocomplete="off"><div class="quiz-form ${noun ? 'one' : ''}"><div class="input-group"><label for="quiz-first">${noun ? 'АНГЛИЙСКОЕ СЛОВО' : 'V2 · PAST SIMPLE'}</label><input id="quiz-first" type="text" spellcheck="false" autocapitalize="off" placeholder="${noun ? 'Ваш перевод' : 'Форма V2'}" ${result ? 'disabled' : ''} class="${result ? (result.firstOk ? 'correct' : 'incorrect') : ''}" value="${escape(result?.first || '')}"></div>${noun ? '' : modal ? '<div class="input-group"><label>V3 · PAST PARTICIPLE</label><div class="modal-explainer">У модального глагола нет формы V3</div></div>' : `<div class="input-group"><label for="quiz-second">V3 · PAST PARTICIPLE</label><input id="quiz-second" type="text" spellcheck="false" autocapitalize="off" placeholder="Форма V3" ${result ? 'disabled' : ''} class="${result ? (result.secondOk ? 'correct' : 'incorrect') : ''}" value="${escape(result?.second || '')}"></div>`}</div><div id="quiz-hint" class="form-hint" aria-live="polite"></div>${result ? `<div class="quiz-result ${result.correct ? 'good' : 'bad'}"><strong>${result.correct ? 'Всё верно!' : 'Правильный ответ:'}</strong>${result.correct ? 'Слово добавлено в следующие повторения.' : escape(answer)}</div>` : ''}<div class="quiz-actions">${result ? '<span></span><button id="quiz-next" class="primary-btn" type="button">Следующее &nbsp; ↗</button>' : '<button id="quiz-dont-know" class="ghost-btn" type="button">Не знаю</button><button class="primary-btn" type="submit">Проверить &nbsp; ↗</button>'}</div></form></div>`;
    if (result) $('#quiz-next').addEventListener('click', () => { quizIndex++; quizResult = null; renderQuiz(); $('#quiz-first')?.focus(); });
    else {
      $('#quiz-form').addEventListener('submit', event => { event.preventDefault(); checkQuiz(); });
      $('#quiz-dont-know').addEventListener('click', () => checkQuiz(true));
    }
  }
  function renderList() {
    const query = $('#search-input').value.trim().toLowerCase();
    const type = $('#list-type').value;
    const filter = $('#list-filter').value;
    const shown = words.filter(word => {
      if (type === 'mine' ? !word.custom : !matchesType(word, type)) return false;
      if (filter === 'new' && !isNew(word)) return false;
      if (filter === 'due' && !isDue(word)) return false;
      if (filter === 'mistakes' && !(state(word)?.wrong > 0)) return false;
      return [word.base, word.past || '', word.participle || '', word.translation].some(value => value.toLowerCase().includes(query));
    });
    $('#list-count').textContent = `${shown.length} из ${words.length}`;
    $('#verb-list').innerHTML = shown.length ? shown.map(word => `<div class="verb-row"><div class="verb-meaning"><span class="verb-id">${word.custom ? '✦' : word.id}</span><div><strong>${escape(word.base)}</strong><small>${escape(word.translation)}</small></div></div><div class="verb-forms">${word.type === 'verb' ? `<span>${escape(word.base)}</span><b>·</b><span>${escape(word.past)}</span><b>·</b><span>${isModal(word) ? '—' : escape(word.participle)}${isModal(word) ? '<small class="modal-note">без V3</small>' : ''}</span>` : '<span class="word-tag">Существительное</span>'}<button type="button" data-say="${escape(word.base)}" aria-label="Произнести ${escape(word.base)}">◖))</button>${word.custom ? `<button type="button" class="delete-word" data-delete="${escape(word.key)}" aria-label="Удалить ${escape(word.base)}">×</button>` : ''}</div></div>`).join('') : '<div class="verb-list-empty">Слов не найдено. Измените запрос или фильтр.</div>';
  }
  function openAdd(type = 'verb') {
    $('#add-panel').hidden = false;
    $('#word-type').value = type;
    syncAddForm();
    $('#add-error').textContent = '';
    $('#word-english').focus();
  }
  function syncAddForm() {
    const verb = $('#word-type').value === 'verb';
    $('#verb-fields').hidden = !verb;
    $('#word-past').required = verb;
    $('#word-participle').required = verb;
    $('#word-english').parentElement.firstChild.textContent = verb ? 'Английское слово (V1)' : 'Английское существительное';
    $('.form-help').hidden = !verb;
  }
  function addWord(event) {
    event.preventDefault();
    const type = $('#word-type').value;
    const base = $('#word-english').value.trim().toLowerCase().replace(/\s+/g, ' ');
    const translation = $('#word-russian').value.trim().replace(/\s+/g, ' ');
    const past = $('#word-past').value.trim().toLowerCase().replace(/\s*;\s*/g, '; ');
    const participle = $('#word-participle').value.trim().toLowerCase().replace(/\s*;\s*/g, '; ');
    const error = $('#add-error');
    if (!/^[a-z][a-z '\-]*$/i.test(base)) { error.textContent = 'Напишите английское слово латинскими буквами.'; return; }
    if (words.some(word => word.type === type && word.base.toLowerCase() === base)) { error.textContent = 'Такое слово в этой части речи уже есть.'; return; }
    if (type === 'verb' && (![past, participle].every(value => /^[a-z][a-z '\-;]*$/i.test(value)))) { error.textContent = 'Проверьте формы V2 и V3: используйте латинские буквы.'; return; }
    if (!translation) { error.textContent = 'Добавьте перевод.'; return; }
    const key = `c:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    custom.push({key,type,base,translation,custom:true,...(type === 'verb' ? {past,participle} : {}),createdAt:Date.now()});
    persist();
    $('#add-form').reset();
    $('#add-panel').hidden = true;
    $('#search-input').value = '';
    $('#list-filter').value = 'all';
    $('#list-type').value = 'mine';
    reviewedThisRun.clear();
    currentKey = null;
    quizUsed.clear();
    rebuildWords();
  }
  function removeWord(key) {
    const word = byKey.get(key);
    if (!word?.custom || !confirm(`Удалить слово «${word.base}» из вашего словаря?`)) return;
    custom = custom.filter(item => item.key !== key);
    delete progress[key];
    persist();
    reviewedThisRun.delete(key);
    quizUsed.delete(key);
    quizDeck = quizDeck.filter(item => item.key !== key);
    if (quizIndex > quizDeck.length) quizIndex = quizDeck.length;
    if (currentKey === key) currentKey = null;
    rebuildWords();
    if (mode === 'quiz') renderQuiz();
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),customWords:custom,progress},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'forms-backup.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importData(file) {
    if (!file || file.size > 1000000) { alert('Выберите файл резервной копии размером до 1 МБ.'); return; }
    try {
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.customWords) || !data.progress || typeof data.progress !== 'object' || Array.isArray(data.progress)) throw new Error();
      if (data.customWords.length > 5000) throw new Error();
      const incoming = data.customWords.filter(validCustom);
      if (incoming.length !== data.customWords.length) throw new Error();
      const known = new Set(custom.map(word => word.key));
      for (const word of incoming) if (!known.has(word.key)) { custom.push({...word, custom:true}); known.add(word.key); }
      for (const [key, value] of Object.entries(data.progress)) if ((/^v:\d+$/.test(key) || known.has(key)) && value && typeof value === 'object' && Number.isFinite(value.box) && Number.isFinite(value.due)) progress[key] = value;
      persist();
      reviewedThisRun.clear(); currentKey = null; quizUsed.clear(); quizDeck = [];
      rebuildWords();
      alert(`Резервная копия загружена. Ваших слов: ${custom.length}.`);
    } catch (_) { alert('Не удалось прочитать резервную копию приложения.'); }
    $('#import-file').value = '';
  }
  function switchMode(next) {
    mode = next;
    document.querySelectorAll('.tab').forEach(button => { const active = button.dataset.tab === next; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `${next}-view`));
    if (next === 'learn') renderLearn();
    if (next === 'quiz') { if (!quizDeck.length) beginQuiz(); else renderQuiz(); }
    if (next === 'list') renderList();
  }

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchMode(button.dataset.tab)));
  document.querySelectorAll('[data-learn-filter]').forEach(button => button.addEventListener('click', () => { learnFilter = button.dataset.learnFilter; currentKey = null; revealed = false; reviewedThisRun.clear(); document.querySelectorAll('[data-learn-filter]').forEach(other => other.classList.toggle('selected', other === button)); renderLearn(); }));
  $('#learn-type').addEventListener('change', event => { learnType = event.target.value; currentKey = null; revealed = false; reviewedThisRun.clear(); renderLearn(); });
  $('#quiz-scope').addEventListener('change', event => { quizScope = event.target.value; quizUsed.clear(); beginQuiz(); });
  $('#search-input').addEventListener('input', renderList);
  $('#list-type').addEventListener('change', renderList);
  $('#list-filter').addEventListener('change', renderList);
  $('#verb-list').addEventListener('click', event => { const say = event.target.closest('[data-say]'); const remove = event.target.closest('[data-delete]'); if (say) speak(say.dataset.say); if (remove) removeWord(remove.dataset.delete); });
  $('#open-add').addEventListener('click', () => openAdd());
  $('#close-add').addEventListener('click', () => { $('#add-panel').hidden = true; $('#add-error').textContent = ''; });
  $('#word-type').addEventListener('change', syncAddForm);
  $('#add-form').addEventListener('submit', addWord);
  $('#export-data').addEventListener('click', exportData);
  $('#import-data').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', event => importData(event.target.files[0]));
  document.addEventListener('keydown', event => { if (mode === 'learn' && event.code === 'Space' && !['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName)) { event.preventDefault(); if (!revealed && currentKey) { revealed = true; renderLearn(); } } });

  renderStats();
  renderLearn();
  renderList();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
