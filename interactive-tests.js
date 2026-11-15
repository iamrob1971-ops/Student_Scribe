/* Student Scribe Phase 1 — Interactive Ask Coach tables.
   Reuses Student_Chats Thread_JSON, localStorage, and the existing Graph sync button.
   Loaded after index.html's main script. Ordinary chats and practice drills are unchanged. */
(function () {
  'use strict';
  const MAX_ROWS = 30;
  const MAX_COLUMNS = 4;
  const stamp = () => new Date().toISOString();
  const safe = v => escapeHtml(String(v == null ? '' : v));
  const clone = v => JSON.parse(JSON.stringify(v));
  const uid = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '_' + Math.random().toString(36).slice(2));
  const DEVICE_KEY = 'ss_test_device_id';
  if (!localStorage.getItem(DEVICE_KEY)) localStorage.setItem(DEVICE_KEY, uid());
  const deviceId = localStorage.getItem(DEVICE_KEY);
  let clock = 0;
  function editClock() { clock = Math.max(Date.now(), clock + 1); return clock; }

  const style = document.createElement('style');
  style.textContent = `
    .msg.ai.it-message{max-width:100%;width:100%;}
    .it-wrap{clear:both;min-width:0;font-size:14px;}
    .it-wrap h3{margin:3px 0 7px;font-size:17px;color:var(--c)}
    .it-scroll{overflow-x:auto;max-width:100%;margin:10px 0;}
    .it-grid{width:100%;border-collapse:collapse;min-width:480px;font-size:13px;}
    .it-grid th,.it-grid td{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:middle;}
    .it-grid th{background:var(--sel);font-weight:700;}
    .it-grid td:first-child{font-weight:600;min-width:125px;}
    .it-input{background:var(--bg);color:var(--ink);border:1.5px solid var(--line);border-radius:8px;
      padding:9px 8px;width:100%;min-width:65px;font-size:14px;}
    .it-input:focus{outline:2px solid var(--c);outline-offset:1px;}
    .it-input.it-number{max-width:95px;}
    .it-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:10px;}
    .it-note{color:var(--mut);font-size:12.5px;line-height:1.45;margin:7px 0;}
    .it-result{padding:10px 12px;border:1px solid var(--line);background:var(--bg);border-radius:10px;margin:10px 0;}
    .it-ok{color:var(--ok);font-weight:650}.it-bad{color:var(--bad);font-weight:650}
    .it-review{font-size:12px;color:var(--mut)}
    .it-status{font-size:12px;color:var(--mut);}
  `;
  document.head.appendChild(style);

  function wantsInteractiveTest(text) {
    const q = String(text || '');
    const interaction = /\b(interactive|editable|fill[ -]?in|fill (out|in)|type (in|my|the)|enter (my|the)|practice test|worksheet|tabular)\b/i.test(q);
    const assessment = /\b(test|table|tabular|matrix|worksheet|quiz|exercise|practice|order number|chronolog|key people)\b/i.test(q);
    const instruction = /\b(create|make|build|generate|give|design|set up|turn|format|want|will|let me)\b/i.test(q);
    return interaction && assessment && instruction;
  }

  const testSchema = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' }, instructions: { type: 'STRING' },
      columns: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        id: { type: 'STRING' }, label: { type: 'STRING' },
        kind: { type: 'STRING', enum: ['number', 'text'] },
        unique: { type: 'BOOLEAN' }
      }, required: ['id', 'label', 'kind'] } },
      rows: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        id: { type: 'STRING' }, label: { type: 'STRING' },
        answers: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
          columnId: { type: 'STRING' }, value: { type: 'STRING' }
        }, required: ['columnId', 'value'] } },
        evidence: { type: 'STRING' }
      }, required: ['id', 'label', 'answers'] } }
    }, required: ['title', 'instructions', 'columns', 'rows']
  };

  function validateDefinition(raw) {
    if (!raw || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) throw new Error('Coach did not return a usable interactive table.');
    if (raw.columns.length < 1 || raw.columns.length > MAX_COLUMNS || raw.rows.length < 2 || raw.rows.length > MAX_ROWS)
      throw new Error(`The table needs 2–${MAX_ROWS} rows and 1–${MAX_COLUMNS} answer columns.`);
    const names = new Set();
    const columns = raw.columns.map((col, i) => {
      const id = String(col.id || `field_${i}`).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
      if (!id || names.has(id)) throw new Error('Duplicate or missing column IDs.');
      names.add(id);
      return { id, label: String(col.label || id).slice(0, 90), kind: col.kind === 'number' ? 'number' : 'text', unique: !!col.unique };
    });
    const seen = new Set();
    const rows = raw.rows.map((row, i) => {
      const id = String(row.id || `row_${i}`).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 50);
      if (!id || seen.has(id)) throw new Error('Duplicate or missing row IDs.');
      seen.add(id);
      const key = {};
      for (const a of Array.isArray(row.answers) ? row.answers : []) {
        const field = columns.find(c => c.id === String(a.columnId || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'));
        if (field) key[field.id] = String(a.value || '').slice(0, 250);
      }
      return { id, label: String(row.label || `Row ${i + 1}`).slice(0, 180), key,
        evidence: String(row.evidence || '').slice(0, 360) };
    });
    return { title: String(raw.title || 'Interactive practice table').slice(0, 130),
      instructions: String(raw.instructions || 'Fill in the table, then check your answers.').slice(0, 600), columns, rows };
  }

  async function createInteractiveTest(text, retry) {
    if (chatBusy) return;
    const input = document.getElementById('chatInput');
    const geminiKey = localStorage.getItem('ss_gemini_key') || '';
    if (!geminiKey) { showToast('Ask a parent to add the Gemini key in Settings (⚙️)'); return; }
    if (!retry) { input.value = ''; autoGrow(input); }
    setChatBusy(true);
    const feed = document.getElementById('chatFeed');
    const el = document.createElement('div'); el.className = 'msg ai';
    const questionEl = document.createElement('div'); questionEl.className = 'msg me'; questionEl.textContent = text;
    if (!retry) feed.appendChild(questionEl);
    feed.appendChild(el); feed.scrollTop = feed.scrollHeight;
    const stop = startThinkingTimer(el);
    const ctl = new AbortController(); const tmo = setTimeout(() => ctl.abort(), CHAT_TIMEOUT_MS);
    const start = Date.now();
    try {
      const targetKey = getActiveChatTargetKey();
      const recent = getVisibleExchanges(targetKey).filter(x => !x.isMiss && x.context !== 'drill' && x.context !== 'guide').slice(-4);
      const history = recent.flatMap(x => [
        { role: 'user', parts: [{ text: x.q }] },
        { role: 'model', parts: [{ text: x.a }] }
      ]);
      const instructions = `You are generating an ACTUAL INTERACTIVE PRACTICE TEST, not a Markdown table.
Return JSON ONLY, using the supplied response schema, for one editable table with row labels and student-entry columns.
Use the conversation and selected CLASS MATERIAL as the primary source. Preserve the teacher's terminology and intended sequence.
If the user requested a particular list or count (such as 13 events), include EXACTLY those rows, mixed into a test order.
For each row: give a stable id, visible label, and expected answers as pairs of columnId and value. Numbers should be answer-key numbers AS STRINGS. For text responses, use comma-separated canonical expected words/names. For answer-key items not supported by the class material or the prior conversation, return an empty string: do not fabricate answers. Include a short evidence note for supported answers.
Do NOT show or explain correct answers in the title, labels, or instructions; these are stored privately in test data. Column kind is number or text. Set unique true when a number such as sequence order may only be used once.
Only table-fill assessments in this version. Never include HTML, Markdown or executable code.
User's test request: ${text}`;
      const result = await queryGeminiWaterfall([...history, { role: 'user', parts: [{ text: instructions }] }],
        geminiKey, getStudyModel(), { system: buildCoachSystem(getSelectedLectures(), { includeTranscript: true, question: text }) + '\n\n' + instructions,
          temperature: 0.1, maxOutputTokens: 11000, responseMimeType: 'application/json', responseSchema: testSchema, signal: ctl.signal });
      const jsonText = result.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const definition = validateDefinition(JSON.parse(jsonText));
      const test = { schemaVersion: 1, testId: uid(), format: 'table_fill', definition,
        draft: { cells: {}, updatedAt: stamp(), checkedAttemptId: '' }, attempts: [] };
      recordExchange(targetKey, text, `Interactive practice test: ${definition.title}`, false, null,
        { context: 'interactive_test', interactiveTest: test, model: result.modelUsed, ms: Date.now() - start });
      loadSubjectChat();
      showToast('Interactive test created. Answers save locally; use Sync to share across devices.');
    } catch (err) {
      el.className = 'msg ai err';
      el.textContent = ctl.signal.aborted ? 'The test request timed out.' : `Could not build this test: ${err.message}`;
      const retryBtn = document.createElement('button'); retryBtn.className = 'btn alt sm'; retryBtn.textContent = '↻ Try again';
      retryBtn.style.marginTop = '8px'; retryBtn.onclick = () => { el.remove(); createInteractiveTest(text, true); };
      el.appendChild(document.createElement('div')); el.appendChild(retryBtn);
    } finally { stop(); clearTimeout(tmo); setChatBusy(false); }
  }

  // Preserve the original Ask Coach behavior for normal chat and standard quiz requests.
  const originalSend = sendChatMessage;
  sendChatMessage = function (query, retry = false) {
    const text = String(query || document.getElementById('chatInput').value || '').trim();
    return wantsInteractiveTest(text) ? createInteractiveTest(text, retry) : originalSend(query, retry);
  };

  function getExchange(targetKey, ts) {
    return loadExchangesForTarget(targetKey).find(x => x.ts === ts && x.interactiveTest);
  }
  function writeExchange(targetKey, ts, edit) {
    const list = loadExchangesForTarget(targetKey);
    const ex = list.find(x => x.ts === ts && x.interactiveTest);
    if (!ex) return null;
    edit(ex.interactiveTest);
    saveExchangesForTarget(targetKey, list);
    return ex.interactiveTest;
  }
  const fieldCell = (test, rowId, columnId) => test.draft?.cells?.[rowId]?.[columnId]?.value || '';
  function attempted(test, id) { return (test.attempts || []).find(x => x.id === id); }
  const clean = value => String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function checkPeople(given, expected) {
    const wanted = String(expected || '').split(/[,;|]/).map(clean).filter(Boolean);
    if (!wanted.length) return null;
    const actual = ` ${clean(given)} `;
    const hits = wanted.filter(x => actual.includes(` ${x} `)).length;
    return hits === wanted.length ? 1 : hits ? 0.5 : 0;
  }
  function grade(test) {
    const d = test.definition; const results = {};
    let earned = 0, max = 0;
    const duplicates = {};
    for (const c of d.columns) if (c.unique) {
      const counts = {};
      d.rows.forEach(r => { const v = clean(fieldCell(test, r.id, c.id)); if (v) counts[v] = (counts[v] || 0) + 1; });
      duplicates[c.id] = counts;
    }
    for (const r of d.rows) {
      results[r.id] = {};
      for (const c of d.columns) {
        const expected = r.key[c.id] || '';
        const entered = fieldCell(test, r.id, c.id);
        const duplicate = !!(c.unique && entered.trim() && duplicates[c.id][clean(entered)] > 1);
        let points = null;
        if (expected.trim()) {
          points = c.kind === 'number' ? (Number(entered) === Number(expected) && entered.trim() !== '' ? 1 : 0)
            : checkPeople(entered, expected);
          if (duplicate) points = 0;
          max += 1; earned += points || 0;
        }
        results[r.id][c.id] = { points, expected, duplicate };
      }
    }
    return { earned, max, results };
  }

  function renderTest(ex, targetKey) {
    const test = ex.interactiveTest, def = test.definition;
    if (!def || !Array.isArray(def.rows) || !Array.isArray(def.columns)) return '<p>Test data could not be read.</p>';
    const active = attempted(test, test.draft?.checkedAttemptId);
    const filled = def.rows.reduce((n, r) => n + def.columns.filter(c => fieldCell(test, r.id, c.id).trim()).length, 0);
    const total = def.rows.length * def.columns.length;
    const rows = def.rows.map(r => {
      const cols = def.columns.map(c => {
        const result = active?.grade?.results?.[r.id]?.[c.id];
        const mark = !result ? '' : result.points === null ? ' ◇' : result.points === 1 ? ' ✓' : result.points > 0 ? ' ◐' : ' ✕';
        const feedback = result?.duplicate ? 'This number is used more than once.' : '';
        return `<td><input class="it-input ${c.kind === 'number' ? 'it-number' : ''}" type="text" ${c.kind === 'number' ? 'inputmode="numeric"' : ''}
            aria-label="${safe(r.label + ': ' + c.label)}" data-it-row="${safe(r.id)}" data-it-column="${safe(c.id)}"
            value="${safe(fieldCell(test, r.id, c.id))}" maxlength="200" autocomplete="off" placeholder="${c.kind === 'number' ? '#' : 'Your answer'}">
            ${mark ? `<span class="it-review">${mark} ${safe(feedback)}</span>` : ''}</td>`;
      });
      return `<tr><td>${safe(r.label)}</td>${cols.join('')}</tr>`;
    }).join('');
    let results = '';
    if (active) {
      const grade = active.grade;
      results = `<div class="it-result"><b>Checked attempt ${test.attempts.length}</b> · ${grade.max ? `${grade.earned}/${grade.max} points on verified fields` : 'No verified answer key available'}
        <div class="it-note">✓ Correct · ◐ Partial · ✕ Review · ◇ Not graded (no verified key).</div>
        ${def.rows.map(r => {
          const flags = def.columns.map(c => {
            const result = grade.results[r.id]?.[c.id];
            if (!result || result.points === null || result.points === 1) return '';
            return `<span>${safe(c.label)}: ${result.points > 0 ? 'Partially correct' : 'Review this'}${result.duplicate ? ' (number repeated)' : ''}${result.expected ? ` · Expected: <b>${safe(result.expected)}</b>` : ''}</span>`;
          }).filter(Boolean);
          return flags.length ? `<p class="it-review"><b>${safe(r.label)}:</b> ${flags.join('; ')}</p>` : '';
        }).join('')}
        </div>`;
    }
    const unverified = def.rows.reduce((n, r) => n + def.columns.filter(c => !String(r.key[c.id] || '').trim()).length, 0);
    return `<div class="it-wrap" data-it-key="${safe(targetKey)}" data-it-ts="${safe(ex.ts)}">
      <div class="it-note">🧩 Interactive Practice · From your class notes</div>
      <h3>${safe(def.title)}</h3><div>${safe(def.instructions)}</div>
      ${unverified ? `<div class="it-note">⚠ ${unverified} answer-key cell(s) could not be verified from the available class material. Those cells will not be scored.</div>` : ''}
      <div class="it-scroll"><table class="it-grid"><thead><tr><th>Event / Prompt</th>${def.columns.map(c => `<th>${safe(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="it-status" role="status">${filled}/${total} cells filled · Saved on this device · Sync to SharePoint to use another device</div>
      ${results}
      <div class="it-actions">
        <button class="btn sm" data-it-action="check">✓ Check answers</button>
        <button class="btn alt sm" data-it-action="revise">✎ Revise answers</button>
        <button class="btn alt sm" data-it-action="retake">↻ Retake / Clear</button>
        <button class="say sm" data-it-action="sync">☁️ Sync to SharePoint</button>
      </div>
      <div class="it-note">${(test.attempts || []).length} submitted check(s) saved in this chat. You can revise answers without losing previous results.</div>
    </div>`;
  }

  const originalLoad = loadSubjectChat;
  loadSubjectChat = function () {
    originalLoad();
    const targetKey = getActiveChatTargetKey();
    const visible = getVisibleExchanges(targetKey).filter(x => !x.isMiss && x.context !== 'drill' && x.context !== 'guide');
    const ai = [...document.querySelectorAll('#chatFeed > .msg.ai')].slice(1);
    visible.forEach((ex, i) => {
      if (!ex.interactiveTest || !ai[i]) return;
      ai[i].classList.add('it-message');
      ai[i].innerHTML = renderTest(ex, targetKey);
    });
  };

  // An input edit immediately modifies the chat's locally saved Thread_JSON and marks it dirty.
  document.addEventListener('input', event => {
    const el = event.target.closest('.it-input');
    if (!el) return;
    const outer = el.closest('.it-wrap'); if (!outer) return;
    const value = el.classList.contains('it-number') ? el.value.replace(/[^0-9]/g, '').slice(0, 4) : el.value;
    if (value !== el.value) el.value = value;
    const state = writeExchange(outer.dataset.itKey, outer.dataset.itTs, test => {
      const row = el.dataset.itRow, field = el.dataset.itColumn;
      if (!test.draft.cells[row]) test.draft.cells[row] = {};
      test.draft.cells[row][field] = { value, editedAt: editClock(), deviceId };
      test.draft.checkedAttemptId = '';
      test.draft.updatedAt = stamp();
    });
    if (!state) return;
    const n = state.definition.rows.reduce((count, r) => count + state.definition.columns.filter(c => fieldCell(state, r.id, c.id).trim()).length, 0);
    outer.querySelector('.it-status').textContent = `${n}/${state.definition.rows.length * state.definition.columns.length} cells filled · Saved locally; SharePoint sync pending`;
  });

  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-it-action]'); if (!btn) return;
    const outer = btn.closest('.it-wrap'); if (!outer) return;
    const targetKey = outer.dataset.itKey, ts = outer.dataset.itTs;
    if (btn.dataset.itAction === 'sync') { document.getElementById('spSyncBtn').click(); return; }
    if (btn.dataset.itAction === 'retake' && !confirm('Clear the current entries and start over? Previous checked attempts will be kept.')) return;
    const saved = writeExchange(targetKey, ts, test => {
      if (btn.dataset.itAction === 'check') {
        const snapshot = {};
        for (const r of test.definition.rows) {
          snapshot[r.id] = {};
          for (const c of test.definition.columns) snapshot[r.id][c.id] = fieldCell(test, r.id, c.id);
        }
        const result = grade(test), id = uid();
        test.attempts = test.attempts || [];
        test.attempts.push({ id, submittedAt: stamp(), responses: snapshot, grade: result });
        test.draft.checkedAttemptId = id;
      } else if (btn.dataset.itAction === 'retake') {
        // Blank entries have timestamps too: a cloud merge must not restore older answers.
        for (const r of test.definition.rows) {
          if (!test.draft.cells[r.id]) test.draft.cells[r.id] = {};
          for (const c of test.definition.columns) {
            test.draft.cells[r.id][c.id] = { value: '', editedAt: editClock(), deviceId };
          }
        }
        test.draft.checkedAttemptId = '';
      } else if (btn.dataset.itAction === 'revise') test.draft.checkedAttemptId = '';
      test.draft.updatedAt = stamp();
    });
    if (saved) {
      outer.outerHTML = renderTest(getExchange(targetKey, ts), targetKey);
      showToast(btn.dataset.itAction === 'check' ? 'Answers checked; attempt saved in chat.' : 'Draft saved locally.');
    }
  });

  const originalHistory = renderHistoryDrawer;
  renderHistoryDrawer = function () {
    originalHistory();
    const targetKey = getActiveChatTargetKey();
    const all = loadExchangesForTarget(targetKey).slice().reverse();
    const items = document.querySelectorAll('#drawerBody > .thread-item');
    all.forEach((ex, i) => {
      if (!ex.interactiveTest || !items[i]) return;
      const label = items[i].querySelector('div');
      if (label) label.textContent = '🧩 Interactive test';
      const b = document.createElement('button'); b.className = 'say sm'; b.style.marginTop = '6px';
      b.textContent = 'Open / Continue test'; b.dataset.itOpen = ex.ts;
      items[i].appendChild(b);
    });
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-it-open]'); if (!button) return;
    document.getElementById('chatHistoryDrawer').classList.remove('open');
    const targetKey = getActiveChatTargetKey(), ex = getExchange(targetKey, button.dataset.itOpen);
    if (!ex) return;
    chatFocus = { key: targetKey, ts: ex.ts, since: stamp() };
    navigateTo('chat'); loadSubjectChat();
  });

  // Both cloud and local versions of an existing exchange can contain newer answers.
  // Merge individual fields by edit timestamp and immutable checked attempts by unique ID.
  function mergeTest(local, remote) {
    if (!local) return clone(remote);
    if (!remote) return clone(local);
    if (local.testId !== remote.testId) return clone(local); // unexpected ID conflict: do not merge unrelated tests
    const merged = clone(remote);
    merged.draft = merged.draft || { cells: {} };
    merged.draft.cells = merged.draft.cells || {};
    const left = local.draft?.cells || {}, right = remote.draft?.cells || {};
    for (const row of new Set([...Object.keys(left), ...Object.keys(right)])) {
      merged.draft.cells[row] = merged.draft.cells[row] || {};
      const lc = left[row] || {}, rc = right[row] || {};
      for (const col of new Set([...Object.keys(lc), ...Object.keys(rc)])) {
        const a = lc[col], b = rc[col];
        const ka = a ? `${String(a.editedAt || 0).padStart(16, '0')}/${a.deviceId || ''}` : '';
        const kb = b ? `${String(b.editedAt || 0).padStart(16, '0')}/${b.deviceId || ''}` : '';
        merged.draft.cells[row][col] = clone(ka >= kb ? (a || b) : b);
      }
    }
    const attempts = new Map();
    for (const a of [...(remote.attempts || []), ...(local.attempts || [])]) if (a && a.id) attempts.set(a.id, a);
    merged.attempts = [...attempts.values()].sort((a, b) => String(a.submittedAt || '').localeCompare(b.submittedAt || ''));
    const newer = String(local.draft?.updatedAt || '') > String(remote.draft?.updatedAt || '') ? local : remote;
    merged.draft.updatedAt = newer.draft?.updatedAt || stamp();
    merged.draft.checkedAttemptId = newer.draft?.checkedAttemptId || '';
    return merged;
  }
  function exchangeKey(ex) { return `${ex.ts}|${ex.q}`; }
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  function mergeExchange(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    const merged = { ...remote, ...local };
    if (local.interactiveTest || remote.interactiveTest) merged.interactiveTest = mergeTest(local.interactiveTest, remote.interactiveTest);
    if (remote.saved || local.saved) merged.saved = true;
    if (!local.visuals && remote.visuals) merged.visuals = remote.visuals;
    return merged;
  }
  function mergeChats(local, remote) {
    const map = new Map(remote.map(ex => [exchangeKey(ex), ex]));
    for (const ex of local) map.set(exchangeKey(ex), mergeExchange(ex, map.get(exchangeKey(ex))));
    return [...map.values()].sort((a, b) => String(a.ts || '').localeCompare(b.ts || ''));
  }
  pullChatsFromSharePoint = async function (siteId, token) {
    const sid = getStudentId(); let changed = 0;
    let url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/Student_Chats/items?$expand=fields&$top=200`;
    while (url) {
      const response = await fetchGraphWithRetry(url, { method: 'GET' }, token);
      const json = await response.json();
      for (const item of (json.value || [])) {
        const f = item.fields || {};
        if (!f.ThreadId || (f.StudentId && String(f.StudentId).toUpperCase() !== sid)) continue;
        let remote; try { remote = JSON.parse(f.Thread_JSON || '[]'); } catch (_) { continue; }
        if (!Array.isArray(remote)) continue;
        const local = loadExchangesForTarget(f.ThreadId);
        const combined = mergeChats(local, remote);
        if (stable(combined) !== stable(local)) {
          localStorage.setItem(`ss_exchanges_${f.ThreadId}`, JSON.stringify(combined)); changed++;
        }
        if (stable(combined) !== stable(remote)) localStorage.setItem(`ss_dirty_chat_${f.ThreadId}`, 'true');
        else localStorage.removeItem(`ss_dirty_chat_${f.ThreadId}`);
      }
      url = json['@odata.nextLink'] || null;
    }
    if (changed && document.getElementById('s-chat').classList.contains('on')) loadSubjectChat();
    return changed;
  };

  const chip = document.createElement('button');
  chip.className = 'btn alt sample-q'; chip.textContent = '🧩 Make interactive table test';
  chip.title = 'Create an editable table that can be checked, revised and synced';
  document.getElementById('chatChips').appendChild(chip);
  // Existing sample button handler supplies this button's text as the Coach prompt.

  // Expose limited diagnostics for automated local tests (no access to keys or answer data).
  window.StudentScribeInteractive = { wantsInteractiveTest, validateDefinition, mergeTest, mergeChats, grade };
})();