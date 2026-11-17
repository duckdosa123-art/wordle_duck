// ==UserScript==
// @name         WordleCup Real-time Solver
// @namespace    wordlecup.solver
// @version      1.0.0
// @description  Watches your WordleCup board and shows entropy-ranked suggestions from a local solver (http://127.0.0.1:5000). Click a suggestion to copy it.
// @match        https://wordlecup.io/*
// @match        https://www.wordlecup.io/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ENDPOINT = 'http://127.0.0.1:5000/board';
  const DEBOUNCE_MS = 600;               // let the tile-flip animation finish
  const STATE = { 'letter-correct': '2', 'letter-elsewhere': '1', 'letter-absent': '0' };
  const ARIA = { correct: '2', elsewhere: '1', no: '0' };

  let lastSnapshot = '';
  let debounceTimer = null;
  let panel = null;

  // ---- board reading ----------------------------------------------------

  function playerRows() {
    // Only the first table that contains guess rows, first 6 rows:
    // opponent mini-boards must never leak into the snapshot.
    const table = [...document.querySelectorAll('table')].find(t => t.querySelector('tr.Row'));
    if (!table) return [];
    return [...table.querySelectorAll('tr.Row')].slice(0, 6);
  }

  function readRow(tr) {
    const cells = [...tr.querySelectorAll('td.Row-letter')];
    if (cells.length !== 5) return null;                                   // not a guess row
    if (!cells.every(td => td.getAttribute('aria-live') === 'off')) return null; // still flipping
    const letters = cells.map(td => td.textContent.trim().toLowerCase());
    const states = cells.map(td => {
      const cls = [...td.classList].find(c => STATE[c]);
      if (cls) return STATE[cls];
      const m = (td.getAttribute('aria-label') || '').match(/: (correct|elsewhere|no)$/i);
      return m ? ARIA[m[1].toLowerCase()] : undefined;                     // fallback parser
    });
    if (states.some(s => s === undefined) || letters.some(l => !/^[a-z]$/.test(l))) return null;
    return { word: letters.join(''), pattern: states.join('') };
  }

  function readBoard() {
    return playerRows().map(readRow).filter(Boolean);
  }

  // ---- transport ----------------------------------------------------------

  function postBoard() {
    const rows = readBoard();
    const snapshot = JSON.stringify(rows);
    if (snapshot === lastSnapshot) return;   // idempotent full snapshots only
    lastSnapshot = snapshot;

    setStatus('solving…');
    GM_xmlhttpRequest({
      method: 'POST',
      url: ENDPOINT,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ v: 1, sentAt: Date.now(), rows }),
      timeout: 10000,
      onload: res => {
        try { render(JSON.parse(res.responseText)); }
        catch (e) { setStatus('bad response from solver'); }
      },
      onerror: () => setStatus('solver unreachable - is solver/server.py running?'),
      ontimeout: () => setStatus('solver timed out'),
    });
  }

  function scheduleRead() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(postBoard, DEBOUNCE_MS);
  }

  // ---- UI (shadow DOM so the page's CSS can't touch it) -------------------

  const CSS = `
    :host { all: initial; }
    .card {
      position: fixed; top: 12px; right: 12px; z-index: 2147483647;
      width: 200px; font: 13px/1.45 system-ui, sans-serif; color: #eee;
      background: rgba(20, 22, 28, .95); border: 1px solid #3a3f4b;
      border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.5);
      user-select: none;
    }
    h4 { margin: 0 0 6px; font-size: 12px; letter-spacing: .06em;
         text-transform: uppercase; color: #8ab4f8; }
    .status { color: #f7b32b; font-size: 12px; margin-top: 6px; min-height: 1em; }
    .sug { display: flex; justify-content: space-between; padding: 3px 4px;
           border-radius: 6px; cursor: pointer; }
    .sug:hover { background: #2b3242; }
    .sug b { font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
    .sug .bits { color: #9aa3b2; font-variant-numeric: tabular-nums; }
    .meta { color: #9aa3b2; font-size: 11px; margin-top: 6px; }
    .tag { font-size: 10px; color: #6ee7a0; margin-left: 6px; }
  `;

  function ensurePanel() {
    if (panel) return panel;
    const host = document.createElement('div');
    host.id = 'wcs-host';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const card = document.createElement('div');
    card.className = 'card';
    root.appendChild(card);
    panel = { card, body: null };
    return panel;
  }

  function setStatus(text) {
    ensurePanel();
    let s = panel.card.querySelector('.status');
    if (!s) {
      s = document.createElement('div');
      s.className = 'status';
      panel.card.appendChild(s);
    }
    s.textContent = text;
  }

  function render(data) {
    ensurePanel();
    if (data.error) return setStatus('error: ' + data.error);
    let body = panel.card.querySelector('.body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'body';
      panel.card.prepend(body);
    }
    body.innerHTML = '';

    const h = document.createElement('h4');
    h.textContent = 'Solver';
    body.appendChild(h);

    if (!data.suggestions || !data.suggestions.length) {
      setStatus(data.note || 'no candidates - check the board');
      return;
    }
    for (const s of data.suggestions) {
      const row = document.createElement('div');
      row.className = 'sug';
      const left = document.createElement('b');
      left.textContent = s.word;
      if (s.is_answer) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'ans';
        left.appendChild(tag);
      }
      const right = document.createElement('span');
      right.className = 'bits';
      right.textContent = s.bits.toFixed(2) + ' bits';
      row.append(left, right);
      row.title = 'click to copy';
      row.addEventListener('click', () => {
        navigator.clipboard?.writeText(s.word);
        setStatus('copied ' + s.word);
      });
      body.appendChild(row);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${data.remaining} candidate${data.remaining === 1 ? '' : 's'} left`;
    body.appendChild(meta);
    setStatus('');
  }

  // ---- wiring ---------------------------------------------------------------

  function watch() {
    // attributes: state classes / aria-live / aria-label change when tiles flip
    new MutationObserver(scheduleRead).observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'aria-live', 'aria-label'],
    });
    setStatus('waiting for board…');
  }

  watch();
})();
