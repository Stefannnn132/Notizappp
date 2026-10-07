/**
 * NotizApp â€” Frontend Logik
 * Frontend: GitHub Pages (statisch)
 * Backend: Google Apps Script Web App â†’ Google Sheets
 *
 * Architektur:
 * - Frontend spricht nur mit der Apps Script Web App URL
 * - Keine Google API Keys im Frontend
 * - Fetch via URLSearchParams (kein JSON Content-Type â†’ kein CORS Preflight bei Apps Script)
 * - Notizen werden als Text gerendert (textContent), nie als HTML â†’ XSS-Schutz
 * - Keine localStorage/sessionStorage (Deployment-Validierung)
 *
 * Datenmodell:
 * - create gibt id, shareToken, editToken zurÃ¼ck
 * - get akzeptiert shareToken (read-only) oder editToken (editable)
 * - update/delete nur mit editToken
 * - Im Demo-Modus gibt es eine Beispiel-Liste + alle Features
 * - Im Produktionsmodus: keine globale Liste, Notizen nur Ã¼ber Links erreichbar
 */

(function () {
  'use strict';

  // ===== State =====
  const state = {
    notes: [],
    currentNote: null,
    searchQuery: '',
    demoMode: false,
    demoNotes: [],
  };

  // API URL aus config.js (falls vorhanden)
  const API_URL = (typeof CONFIG !== 'undefined' && CONFIG.API_URL) ? CONFIG.API_URL : '';

  // Demo-Modus aktivieren wenn keine API URL konfiguriert
  if (!API_URL || API_URL.includes('DEINE_APPS_SCRIPT')) {
    state.demoMode = true;
    // Demo-Daten
    state.demoNotes = [
      {
        id: 'demo-1',
        shareToken: 'demo-token-1',
        editToken: 'demo-edit-1',
        title: 'Willkommen bei NotizApp',
        content: 'Das ist eine Demo-Notiz.\n\nUm die App mit echtem Backend zu nutzen:\n1. Google Sheet erstellen\n2. Apps Script einrichten (Code.gs)\n3. Als Web App deployen\n4. URL in config.js eintragen\n\nSiehe README.md fÃ¼r die komplette Anleitung.',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'demo-2',
        shareToken: 'demo-token-2',
        editToken: 'demo-edit-2',
        title: 'Einkaufsliste Wochenende',
        content: '- Brot\n- KÃ¤se\n- Tomaten\n- OlivenÃ¶l\n- Basilikum',
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        updatedAt: new Date(Date.now() - 172800000).toISOString(),
      },
      {
        id: 'demo-3',
        shareToken: 'demo-token-3',
        editToken: 'demo-edit-3',
        title: 'Projektideen',
        content: '1. Wetter-App mit Vorhersage\n2. Rezept-Sammlung\n3. Reiseplaner\n4. Habit Tracker',
        createdAt: new Date(Date.now() - 259200000).toISOString(),
        updatedAt: new Date(Date.now() - 129600000).toISOString(),
      },
    ];
  }

  // ===== DOM =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const elements = {
    views: {
      home: $('[data-view="home"]'),
      editor: $('[data-view="editor"]'),
      shared: $('[data-view="shared"]'),
    },
    intro: $('[data-intro]'),
    notesList: $('[data-notes-list]'),
    search: $('[data-search]'),
    noteTitle: $('#note-title'),
    noteContent: $('#note-content'),
    sharedTitle: $('[data-shared-title]'),
    sharedDate: $('[data-shared-date]'),
    sharedContent: $('[data-shared-content]'),
    shareModal: $('[data-share-modal]'),
    shareUrl: $('[data-share-url]'),
    editUrl: $('[data-edit-url]'),
    toast: $('[data-toast]'),
    homeContent: $('[data-home-content]'),
  };

  // ===== Utilities =====
  function formatDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'gerade eben';
    if (mins < 60) return `vor ${mins} Min.`;
    if (hours < 24) return `vor ${hours} Std.`;
    if (days < 7) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;

    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: 'short',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function generateToken() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('toast--show');
    setTimeout(() => {
      elements.toast.classList.remove('toast--show');
    }, 3000);
  }

  function getBaseUrl() {
    return window.location.origin + window.location.pathname;
  }

  // ===== View Router =====
  function showView(name) {
    Object.values(elements.views).forEach((v) => v.classList.remove('view--active'));
    elements.views[name].classList.add('view--active');

    // Intro nur auf Home zeigen
    if (elements.intro) {
      elements.intro.style.display = name === 'home' ? 'block' : 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===== API =====
  async function apiCall(action, params = {}) {
    if (state.demoMode) {
      return demoApiCall(action, params);
    }

    const body = new URLSearchParams({ action, ...params });

    const response = await fetch(API_URL, {
      method: 'POST',
      body: body,
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Unbekannter Fehler');
    }

    return data;
  }

  // Demo API (in-memory, falls keine config.js vorhanden)
  async function demoApiCall(action, params) {
    await new Promise((r) => setTimeout(r, 200));

    switch (action) {
      case 'list':
        // Demo: gibt komplette Notizen zurÃ¼ck (nur im Demo-Modus)
        return { ok: true, notes: state.demoNotes };

      case 'create': {
        const note = {
          id: generateId(),
          shareToken: generateToken(),
          editToken: generateToken(),
          title: params.title || 'Ohne Titel',
          content: params.content || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.demoNotes.unshift(note);
        return { ok: true, note };
      }

      case 'get': {
        const note = state.demoNotes.find((n) => n.id === params.id);
        if (!note) return { ok: false, error: 'Notiz nicht gefunden' };
        // Accept either shareToken (read-only) or editToken (editable)
        if (note.shareToken === params.token) {
          return { ok: true, note: { ...note, editable: false } };
        }
        if (note.editToken === params.token) {
          return { ok: true, note: { ...note, editable: true } };
        }
        return { ok: false, error: 'UngÃ¼ltiger Token' };
      }

      case 'update': {
        const note = state.demoNotes.find((n) => n.id === params.id);
        if (!note) return { ok: false, error: 'Notiz nicht gefunden' };
        if (note.editToken !== params.editToken) return { ok: false, error: 'UngÃ¼ltiger editToken' };
        note.title = params.title || note.title;
        note.content = params.content !== undefined ? params.content : note.content;
        note.updatedAt = new Date().toISOString();
        return { ok: true, note };
      }

      case 'delete': {
        const note = state.demoNotes.find((n) => n.id === params.id);
        if (!note) return { ok: false, error: 'Notiz nicht gefunden' };
        if (note.editToken !== params.editToken) return { ok: false, error: 'UngÃ¼ltiger editToken' };
        const idx = state.demoNotes.findIndex((n) => n.id === params.id);
        state.demoNotes.splice(idx, 1);
        return { ok: true };
      }

      default:
        return { ok: false, error: 'Unbekannte Aktion' };
    }
  }

  // ===== Home Rendering =====
  function renderHome() {
    if (state.demoMode) {
      // Demo-Modus: Zeige Notiz-Liste mit Demo-Daten
      renderNotesList();
    } else {
      // Produktionsmodus: Keine globale Liste, nur Erstellen + Link-Hinweis
      renderProductionHome();
    }
  }

  function renderProductionHome() {
    elements.homeContent.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 13h6M9 17h4" />
        </svg>
        <h3>Notizen Ã¼ber Links</h3>
        <p>Erstelle eine neue Notiz und du erhÃ¤ltst einen Lese- und einen Bearbeitungslink. Bestehende Notizen Ã¶ffnest du Ã¼ber diese Links â€” sie werden nicht Ã¶ffentlich gelistet.</p>
        <button class="btn btn--primary" data-action="new-note">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Neue Notiz erstellen
        </button>
      </div>
    `;
  }

  // ===== Notes List (Demo Mode) =====
  function renderNotesList() {
    const filtered = state.searchQuery
      ? state.notes.filter(
          (n) =>
            (n.title || '').toLowerCase().includes(state.searchQuery) ||
            (n.content || '').toLowerCase().includes(state.searchQuery)
        )
      : state.notes;

    if (filtered.length === 0) {
      elements.homeContent.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M9 13h6M9 17h4" />
          </svg>
          <h3>${state.searchQuery ? 'Keine Treffer' : 'Noch keine Notizen'}</h3>
          <p>${state.searchQuery ? 'Versuche eine andere Suchanfrage.' : 'Erstelle deine erste Notiz, um loszulegen.'}</p>
          ${!state.searchQuery ? '<button class="btn btn--primary" data-action="new-note">Notiz erstellen</button>' : ''}
        </div>
      `;
      return;
    }

    elements.homeContent.innerHTML = `
      <div class="notes-grid">${filtered.map(renderNoteCard).join('')}</div>
      <p class="demo-hint">Demo-Modus: Diese Notizen sind Beispieldaten. Im Produktionsmodus sind Notizen nur Ã¼ber Links erreichbar.</p>
    `;
  }

  function renderNoteCard(note) {
    const preview = (note.content || '').slice(0, 150);
    const title = note.title || 'Ohne Titel';

    return `
      <article class="note-card" data-note-id="${note.id}">
        <h3 class="note-card__title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
        <p class="note-card__preview">${escapeHtml(preview)}</p>
        <div class="note-card__footer">
          <span class="note-card__date">${formatDate(note.updatedAt || note.createdAt)}</span>
          <div class="note-card__actions">
            <button class="note-card__action" data-card-action="edit" data-note-id="${note.id}" aria-label="Bearbeiten" title="Bearbeiten">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
            <button class="note-card__action" data-card-action="share" data-note-id="${note.id}" aria-label="Teilen" title="Teilen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
              </svg>
            </button>
            <button class="note-card__action" data-card-action="delete" data-note-id="${note.id}" aria-label="LÃ¶schen" title="LÃ¶schen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  // ===== Load Notes (Demo only) =====
  async function loadNotes() {
    if (!state.demoMode) {
      renderHome();
      return;
    }

    try {
      const data = await apiCall('list');
      state.notes = data.notes || [];
      renderHome();
    } catch (err) {
      showToast('Fehler beim Laden der Notizen');
      state.notes = [];
      renderHome();
    }
  }

  // ===== Editor =====
  function openEditor(note) {
    state.currentNote = note;
    elements.noteTitle.value = note ? note.title || '' : '';
    elements.noteContent.value = note ? note.content || '' : '';
    showView('editor');
    setTimeout(() => elements.noteTitle.focus(), 300);
  }

  async function saveNote() {
    const title = elements.noteTitle.value.trim();
    const content = elements.noteContent.value;

    if (!title && !content) {
      showToast('Titel oder Inhalt darf nicht leer sein');
      return;
    }

    try {
      if (state.currentNote) {
        // Update â€” needs editToken
        await apiCall('update', {
          id: state.currentNote.id,
          editToken: state.currentNote.editToken,
          title: title || 'Ohne Titel',
          content: content,
        });
        showToast('Notiz aktualisiert');
      } else {
        // Create
        const data = await apiCall('create', {
          title: title || 'Ohne Titel',
          content: content,
        });
        state.currentNote = data.note;
        showToast('Notiz erstellt');
        // Show share modal with both links
        openShareModal(data.note);
        return;
      }
      await loadNotes();
      showView('home');
    } catch (err) {
      showToast('Fehler beim Speichern: ' + err.message);
    }
  }

  async function deleteNote() {
    if (!state.currentNote) return;

    const confirmed = confirm('MÃ¶chtest du diese Notiz wirklich lÃ¶schen?');
    if (!confirmed) return;

    try {
      await apiCall('delete', { 
        id: state.currentNote.id, 
        editToken: state.currentNote.editToken 
      });
      state.currentNote = null;
      showToast('Notiz gelÃ¶scht');
      await loadNotes();
      showView('home');
    } catch (err) {
      showToast('Fehler beim LÃ¶schen: ' + err.message);
    }
  }

  // ===== Sharing =====
  function openShareModal(note) {
    const baseUrl = getBaseUrl();
    const shareUrl = `${baseUrl}?note=${note.id}&token=${note.shareToken}`;
    const editUrl = `${baseUrl}?edit=${note.id}&key=${note.editToken}`;
    
    elements.shareUrl.value = shareUrl;
    if (elements.editUrl) {
      elements.editUrl.value = editUrl;
    }
    elements.shareModal.classList.add('modal-overlay--open');
  }

  function closeShareModal() {
    elements.shareModal.classList.remove('modal-overlay--open');
  }

  function copyShareLink(input) {
    if (!input) return;
    input.select();
    input.setSelectionRange(0, 99999);
    try {
      navigator.clipboard.writeText(input.value);
      showToast('Link in die Zwischenablage kopiert');
    } catch {
      document.execCommand('copy');
      showToast('Link kopiert');
    }
  }

  // ===== Shared Note View (read-only) =====
  async function loadSharedNote(id, token) {
    try {
      const data = await apiCall('get', { id, token });
      const note = data.note;

      // TextContent nutzen (XSS-Schutz)
      elements.sharedTitle.textContent = note.title || 'Ohne Titel';
      elements.sharedDate.textContent = 'Erstellt: ' + formatDate(note.createdAt);
      elements.sharedContent.textContent = note.content || '';

      showView('shared');
    } catch (err) {
      elements.sharedTitle.textContent = 'Nicht gefunden';
      elements.sharedDate.textContent = '';
      elements.sharedContent.textContent = 'Diese Notiz existiert nicht oder der Link ist ungÃ¼ltig.';
      showView('shared');
    }
  }

  // ===== Edit Note via Link (editToken) =====
  async function loadEditableNote(id, editToken) {
    try {
      const data = await apiCall('get', { id, token: editToken });
      const note = data.note;
      // Store note with editToken for saving
      state.currentNote = {
        id: note.id,
        shareToken: note.shareToken,
        editToken: editToken,
        title: note.title,
        content: note.content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
      openEditor(state.currentNote);
    } catch (err) {
      showToast('Notiz nicht gefunden oder ungÃ¼ltiger Link');
      renderHome();
      showView('home');
    }
  }

  // ===== Event Handlers =====
  function handleNav(action) {
    switch (action) {
      case 'home':
        state.currentNote = null;
        renderHome();
        showView('home');
        break;
    }
  }

  function handleAction(action) {
    switch (action) {
      case 'new-note':
        openEditor(null);
        break;
      case 'save-note':
        saveNote();
        break;
      case 'delete-note':
        deleteNote();
        break;
      case 'share-note':
        if (state.currentNote) {
          openShareModal(state.currentNote);
        } else if (elements.noteTitle.value || elements.noteContent.value) {
          // Erst speichern, dann teilen
          saveNote().then(() => {
            if (state.currentNote) openShareModal(state.currentNote);
          });
        }
        break;
      case 'copy-share-link':
        copyShareLink(elements.shareUrl);
        break;
      case 'copy-edit-link':
        copyShareLink(elements.editUrl);
        break;
    }
  }

  function handleCardAction(action, noteId) {
    const note = state.notes.find((n) => n.id === noteId);
    if (!note) return;

    switch (action) {
      case 'edit':
        openEditor(note);
        break;
      case 'share':
        openShareModal(note);
        break;
      case 'delete':
        const confirmed = confirm('MÃ¶chtest du diese Notiz wirklich lÃ¶schen?');
        if (confirmed) {
          apiCall('delete', { 
            id: noteId, 
            editToken: note.editToken 
          })
            .then(() => {
              showToast('Notiz gelÃ¶scht');
              loadNotes();
            })
            .catch(() => showToast('Fehler beim LÃ¶schen'));
        }
        break;
    }
  }

  // ===== Init =====
  function init() {
    // Theme Toggle
    const themeToggle = $('[data-theme-toggle]');
    const root = document.documentElement;
    let currentTheme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    root.setAttribute('data-theme', currentTheme);

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', currentTheme);
        themeToggle.setAttribute('aria-label', 'Zu ' + (currentTheme === 'dark' ? 'light' : 'dark') + ' mode wechseln');
        themeToggle.innerHTML =
          currentTheme === 'dark'
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
      });
    }

    // Navigation
    document.addEventListener('click', (e) => {
      const navEl = e.target.closest('[data-nav]');
      if (navEl) {
        e.preventDefault();
        handleNav(navEl.dataset.nav);
        return;
      }

      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        handleAction(actionEl.dataset.action);
        return;
      }

      const cardActionEl = e.target.closest('[data-card-action]');
      if (cardActionEl) {
        handleCardAction(cardActionEl.dataset.cardAction, cardActionEl.dataset.noteId);
        return;
      }

      const closeShareEl = e.target.closest('[data-close-share]');
      if (closeShareEl || e.target === elements.shareModal) {
        closeShareModal();
        return;
      }
    });

    // Search (demo mode only)
    if (elements.search) {
      elements.search.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        if (state.demoMode) {
          renderHome();
        }
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (elements.shareModal.classList.contains('modal-overlay--open')) {
          closeShareModal();
        }
      }
      // Ctrl/Cmd + Enter im Editor â†’ Speichern
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const editorView = elements.views.editor;
        if (editorView.classList.contains('view--active')) {
          saveNote();
        }
      }
    });

    // Check URL for shared or editable note
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get('note');
    const token = params.get('token');
    const editId = params.get('edit');
    const editKey = params.get('key');

    if (noteId && token) {
      // Read-only shared note
      loadSharedNote(noteId, token);
    } else if (editId && editKey) {
      // Editable note via editToken
      loadEditableNote(editId, editKey);
    } else {
      // Home view
      loadNotes();
      showView('home');
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
