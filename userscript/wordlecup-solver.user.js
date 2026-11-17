// ==UserScript==
// @name         Wordle Real-time Solver (WordleCup / wordlegame.org / wordlevs.com)
// @namespace    wordlecup.solver
// @version      1.1.0
// @description  Watches your Wordle board and shows entropy-ranked suggestions from a local solver (http://127.0.0.1:5000). Click a suggestion to copy it. Supports wordlecup.io, wordlegame.org and wordlevs.com.
// @match        https://wordlecup.io/*
// @match        https://www.wordlecup.io/*
// @match        https://wordlegame.org/*
// @match        https://www.wordlegame.org/*
// @match        https://wordlevs.com/*
// @match        https://www.wordlevs.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ENDPOINT = 'http://127.0.0.1:5000/board';
  const DEBOUNCE_MS = 600;               // let the tile-flip animation finish

  // ---- shared parsing helpers ---------------------------------------------

  // class name -> pattern digit
  const STATE = { 'letter-correct': '2', 'letter-elsewhere': '1', 'letter-absent': '0' };
  const ARIA = { correct: '2', elsewhere: '1', no: '0' };

  // Assemble a {word, pattern} or null if anything is missing/invalid.
  function finishRow(letters, states) {
    if (states.some(s => s === undefined) || letters.some(l => !/^[a-z]$/.test(l))) return null;
    return { word: letters.join(''), pattern: states.join('') };
  }

  function letterText(el, skip) {
    let t = el.textContent;
    for (const s of skip) t = t.replace(s, '');
    return t.trim().toLowerCase();
  }

  // ---- WordleCup.io --------------------------------------------------------
  // Guess rows are <tr class="Row"> inside the first table that has any;
  // cells are <td class="Row-letter letter-*">. Opponent mini-boards must
  // never leak into the snapshot.

  function wordlecupRows() {
    const table = [...document.querySelectorAll('table')].find(t => t.querySelector('tr.Row'));
    if (!table) return [];
    return [...table.querySelectorAll('tr.Row')].slice(0, 6);
  }

  function wordlecupRead(tr) {
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
    return finishRow(letters, states);
  }

  // ---- wordlegame.org ------------------------------------------------------
  // Tiles are <div class="Row-letter letter-correct|letter-elsewhere|letter-absent"
  // data-animation="none">c<sup style="display:none;">1</sup></div>. A row is
  // finished only when every tile has data-animation="none" (i.e. the flip
  // animation is done). The <sup> holds a keyboard hint and must be ignored
  // when reading the letter.

  function wordlegameRows() {
    // Group tiles by their parent so we never depend on the row's own class name.
    const rows = [];
    for (const tile of document.querySelectorAll('.Row-letter')) {
      const p = tile.parentElement;
      if (!rows.includes(p) && p.querySelectorAll('.Row-letter').length === 5) rows.push(p);
    }
    return rows.slice(0, 6);
  }

  function wordlegameRead(row) {
    const cells = [...row.querySelectorAll('.Row-letter')];
    if (cells.length !== 5) return null;
    // still animating (attribute present with a non-"none" value)
    if (cells.some(td => (td.getAttribute('data-animation') || 'none') !== 'none')) return null;
    const letters = cells.map(td => letterText(td, [...td.querySelectorAll('sup')].map(s => s.textContent)));
    const states = cells.map(td => {
      const cls = [...td.classList].find(c => STATE[c]);
      return cls ? STATE[cls] : undefined;
    });
    return finishRow(letters, states);
  }

  // ---- wordlevs.com --------------------------------------------------------
  // Rows are [data-testid="board-row"], tiles are direct children. A submitted
  // tile carries an important DaisyUI override: green = !bg-success, yellow =
  // !bg-warning, gray = any other !bg-*. Tiles still being typed keep the
  // plain bg-base-100 (no "!bg-"), so they read as unfinished.

  function wordlevsRows() {
    let rows = [...document.querySelectorAll('[data-testid="board-row"]')];
    // Multiplayer: prefer an explicit player-board container so rival boards
    // can never leak into the snapshot.
    const board = document.querySelector(
      '[data-testid="board"], [data-testid="player-board"], [data-testid="my-board"]');
    if (board) {
      rows = [...board.querySelectorAll('[data-testid="board-row"]')];
    } else if (rows.length > 6) {
      console.warn('[solver] no player-board container found; using first 6 board-rows');
      rows = rows.slice(0, 6);
    }
    return rows;
  }

  function wordlevsRead(row) {
    const cells = [...row.children];
    if (cells.length !== 5) return null;
    const letters = cells.map(td => td.textContent.trim().toLowerCase());
    const states = cells.map(td => {
      const cls = td.className;
      if (cls.includes('!bg-success')) return '2';
      if (cls.includes('!bg-warning')) return '1';
      if (cls.includes('!bg-')) return '0';      // submitted, neither green nor yellow
      return undefined;                          // typed but not yet submitted
    });
    return finishRow(letters, states);
  }

  // ---- site selection ------------------------------------------------------

  const ADAPTERS = {
    'wordlecup.io':   { rows: wordlecupRows,  read: wordlecupRead },
    'wordlegame.org': { rows: wordlegameRows, read: wordlegameRead },
    'wordlevs.com':   { rows: wordlevsRows,   read: wordlevsRead },
  };

  const adapter = ADAPTERS[location.hostname.replace(/^www\./, '')];

  // ---- board reading -------------------------------------------------------

  let lastSnapshot = '';
  let debounceTimer = null;
  let panel = null;

  function readBoard() {
    if (!adapter) return [];
    return adapter.rows().map(adapter.read).filter(Boolean);
  }

  // ---- transport -----------------------------------------------------------

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

  // ---- UI (shadow DOM so the page's CSS can't touch it) --------------------

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

  // ---- wiring ----------------------------------------------------------------

  function watch() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', watch, { once: true });
      return;
    }
    // attributes: state classes / aria-live / aria-label / data-animation
    // change when tiles flip
    new MutationObserver(scheduleRead).observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'aria-live', 'aria-label', 'data-animation'],
    });
    setStatus('waiting for board…');
  }

  if (!adapter) {
    console.warn('[solver] unsupported site:', location.hostname);
    return;
  }
  console.log('[solver] site adapter:', location.hostname);
  watch();
})();
