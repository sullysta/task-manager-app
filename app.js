/* ============================================================
   Sully's Task Manager — app.js
   All application logic: GitHub API, state, CRUD, rendering
   ============================================================ */

'use strict';

// ── Configuration ─────────────────────────────────────────────
const BASE_PATH = '/task-manager-app';   // GitHub Pages URL prefix
const GITHUB_API = 'https://api.github.com';
const UPCOMING_DAYS = 14;                 // Days ahead to show as "upcoming"

// Category registry — add new categories here in the future
const CATEGORIES = {
  personal: { label: 'Personal', type: 'tasks', file: 'personal/tasks.json' },
  church:   { label: 'Church',   type: 'tasks', file: 'church/tasks.json'   },
  work:     { label: 'Work',     type: 'cases', file: 'work/cases.json'     },
};

const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', color: '#e94560', rank: 1 },
  high:   { label: 'High',   color: '#ff6b35', rank: 2 },
  normal: { label: 'Normal', color: '#4a90e2', rank: 3 },
  low:    { label: 'Low',    color: '#707888', rank: 4 },
};

const GROUP_DEFS = [
  { key: 'overdue',    label: '⚠ Overdue',    cls: 'grp-overdue',    defaultOpen: true  },
  { key: 'dueToday',  label: '📅 Due Today',  cls: 'grp-duetoday',   defaultOpen: true  },
  { key: 'upcoming',  label: '🔜 Upcoming',   cls: 'grp-upcoming',   defaultOpen: true  },
  { key: 'active',    label: 'Active',         cls: '',               defaultOpen: true  },
  { key: 'onHold',    label: '⏸ On Hold',     cls: 'grp-onhold',     defaultOpen: false },
  { key: 'backlogged',label: '📋 Backlogged',  cls: 'grp-backlogged', defaultOpen: false },
];

// ── Application State ──────────────────────────────────────────
const STATE = {
  activeTab:   'personal',
  settings:    { owner: '', repo: '', token: '' },
  data:        { personal: null, church: null, work: null },
  fileSHAs:    { personal: null, church: null, work: null },
  loading:     false,
  searchQuery: '',
};

// ── Settings (localStorage) ────────────────────────────────────
function loadSettings() {
  STATE.settings.owner = localStorage.getItem('gh_owner') || '';
  STATE.settings.repo  = localStorage.getItem('gh_repo')  || '';
  STATE.settings.token = localStorage.getItem('gh_token') || '';
}

function saveSettings(owner, repo, token) {
  localStorage.setItem('gh_owner', owner);
  localStorage.setItem('gh_repo',  repo);
  localStorage.setItem('gh_token', token);
  STATE.settings = { owner, repo, token };
}

function hasSettings() {
  const { owner, repo, token } = STATE.settings;
  return !!(owner && repo && token);
}

// ── GitHub API ─────────────────────────────────────────────────
async function githubGet(filePath) {
  const { owner, repo, token } = STATE.settings;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Authentication failed — check your GitHub token');
    if (response.status === 403) throw new Error('Access denied — check token permissions');
    if (response.status === 404) throw new Error(`File not found: ${filePath} — check your repository name`);
    throw new Error(`GitHub error (${response.status}): ${err.message || 'Unknown error'}`);
  }
  const data = await response.json();
  // GitHub returns base64-encoded content, possibly with newlines
  const decoded = atob(data.content.replace(/\n/g, ''));
  return { sha: data.sha, content: JSON.parse(decoded) };
}

async function githubPut(filePath, content, sha, commitMessage) {
  const { owner, repo, token } = STATE.settings;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`;
  // Unicode-safe base64 encoding (handles emojis, accents, etc.)
  const jsonStr = JSON.stringify(content, null, 2);
  const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ message: commitMessage, content: encoded, sha }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 409) {
      throw new Error('Data was modified elsewhere. Please refresh the page and try again.');
    }
    throw new Error(`GitHub write error (${response.status}): ${err.message || 'Unknown error'}`);
  }
  const result = await response.json();
  return result.content.sha;  // Return new SHA for the next write
}

// ── Data Layer ─────────────────────────────────────────────────
async function loadSection(section) {
  setLoading(true);
  try {
    const cat = CATEGORIES[section];
    const { sha, content } = await githubGet(cat.file);
    STATE.data[section] = content;
    STATE.fileSHAs[section] = sha;
    renderSection(section);
  } catch (err) {
    showToast(`Failed to load ${section} data: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function saveSection(section, commitMessage) {
  const cat = CATEGORIES[section];
  const newSha = await githubPut(
    cat.file,
    STATE.data[section],
    STATE.fileSHAs[section],
    commitMessage,
  );
  STATE.fileSHAs[section] = newSha;
}

// ── Utilities ──────────────────────────────────────────────────
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getUpcomingLimitStr() {
  const d = new Date();
  d.setDate(d.getDate() + UPCOMING_DAYS);
  return d.toISOString().slice(0, 10);
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const today = getTodayStr();
  if (dateStr < today) {
    return { text: `Overdue: ${formatDate(dateStr + 'T12:00:00')}`, cls: 'overdue' };
  }
  if (dateStr === today) {
    return { text: 'Due Today', cls: 'due-today' };
  }
  return { text: `Due ${formatDate(dateStr + 'T12:00:00')}`, cls: '' };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 450);
  }, 3200);
}

function setLoading(isLoading) {
  STATE.loading = isLoading;
  const bar = document.getElementById('loading-bar');
  if (isLoading) {
    bar.removeAttribute('hidden');
    bar.classList.add('active');
    bar.classList.remove('done');
    document.body.classList.add('loading');
  } else {
    bar.classList.remove('active');
    bar.classList.add('done');
    document.body.classList.remove('loading');
    setTimeout(() => {
      bar.setAttribute('hidden', '');
      bar.classList.remove('done');
    }, 400);
  }
}

// ── Grouping & Sorting ─────────────────────────────────────────
function groupItems(items) {
  const today         = getTodayStr();
  const upcomingLimit = getUpcomingLimitStr();

  const groups = { overdue: [], dueToday: [], upcoming: [], active: [], onHold: [], backlogged: [] };

  for (const item of items) {
    if (item.status === 'on_hold') {
      groups.onHold.push(item);
    } else if (item.status === 'backlogged') {
      groups.backlogged.push(item);
    } else {
      // status === 'active' (or missing)
      const d = item.due_date;
      if (d) {
        if (d < today)             groups.overdue.push(item);
        else if (d === today)      groups.dueToday.push(item);
        else if (d <= upcomingLimit) groups.upcoming.push(item);
        else                       groups.active.push(item);
      } else {
        groups.active.push(item);
      }
    }
  }

  for (const key of Object.keys(groups)) groups[key].sort(sortByPriorityThenDate);
  return groups;
}

function sortByPriorityThenDate(a, b) {
  const ra = PRIORITY_CONFIG[a.priority]?.rank ?? 3;
  const rb = PRIORITY_CONFIG[b.priority]?.rank ?? 3;
  if (ra !== rb) return ra - rb;
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return (a.created_at || '').localeCompare(b.created_at || '');
}

// ── Search ─────────────────────────────────────────────────────
function filterCases(query, cases) {
  if (!query || !query.trim()) return cases;
  const q = query.toLowerCase();
  return cases.filter(c =>
    (c.case_number        || '').toLowerCase().includes(q) ||
    (c.submitting_agency  || '').toLowerCase().includes(q) ||
    (c.case_agent         || '').toLowerCase().includes(q) ||
    (c.synopsis           || '').toLowerCase().includes(q)
  );
}

// ── Rendering ──────────────────────────────────────────────────
function renderSection(section) {
  if (!STATE.data[section]) return;
  const cat = CATEGORIES[section];
  if (cat.type === 'tasks') renderTaskSection(section);
  else renderWorkSection();
  updateAllBadges();
}

// Update tab badge count after rendering
function updateTabBadge(section) {
  const badge = document.querySelector(`[data-badge="${section}"]`);
  if (!badge) return;
  const data = STATE.data[section];
  if (!data) {
    badge.textContent = "";
    return;
  }
  const activeTasks = data.tasks ? data.tasks.filter(t => !t.completed) : data.cases ? data.cases.filter(c => !c.completed) : [];
  const count = activeTasks.length;
  badge.textContent = count;
  badge.style.display = count > 0 ? "inline-flex" : "none";
}

function updateAllBadges() {
  ["personal", "church", "work"].forEach(updateTabBadge);
}

// Preload all sections in background for badge counts on page load
async function preloadAllSections() {
  if (!hasSettings()) return;
  for (const section of ["personal", "church", "work"]) {
    try {
      const cat = CATEGORIES[section];
      const { sha, content } = await githubGet(cat.file);
      STATE.data[section] = content;
      STATE.fileSHAs[section] = sha;
    } catch (e) {
      // Ignore errors - section may not exist yet
    }
  }
  updateAllBadges();
}

function preserveAndRender(containerId, renderFn) {
  const container = document.getElementById(containerId);
  const hadContent = container && container.children.length > 0;
  const openIds = new Set();
  if (hadContent && container) {
    container.querySelectorAll('details[id]').forEach(d => {
      if (d.open) openIds.add(d.id);
    });
  }
  renderFn();
  if (hadContent && container && openIds.size > 0) {
    container.querySelectorAll('details[id]').forEach(d => {
      d.open = openIds.has(d.id);
    });
  }
}

function renderTaskSection(section) {
  const data = STATE.data[section];
  preserveAndRender(`${section}-groups`, () => {
    const groups = groupItems(data.tasks);
    const container = document.getElementById(`${section}-groups`);
    container.innerHTML = GROUP_DEFS.map(({ key, label, cls, defaultOpen }) => {
      const items = groups[key];
      if (items.length === 0 && key !== 'active') return '';
      return renderGroupSection(
        `${section}-${key}`,
        label, cls,
        items.map(t => renderTaskCard(t, section, false)).join(''),
        items.length, defaultOpen,
      );
    }).join('');
  });

  // Archive
  const archiveEl = document.getElementById(`${section}-archive`);
  if (archiveEl) {
    archiveEl.innerHTML = data.archive
      .slice()
      .reverse()
      .map(t => renderTaskCard(t, section, true))
      .join('');
    const countEl = document.getElementById(`${section}-archive-count`);
    if (countEl) countEl.textContent = data.archive.length;
  }
}

function renderWorkSection() {
  const data = STATE.data.work;
  const query = STATE.searchQuery;

  preserveAndRender('work-groups', () => {
    const filtered = filterCases(query, data.cases);
    const groups = groupItems(filtered);
    const container = document.getElementById('work-groups');
    container.innerHTML = GROUP_DEFS.map(({ key, label, cls, defaultOpen }) => {
      const items = groups[key];
      if (items.length === 0 && key !== 'active') return '';
      return renderGroupSection(
        `work-${key}`,
        label, cls,
        items.map(c => renderCaseCard(c, false)).join(''),
        items.length, defaultOpen,
      );
    }).join('');
  });

  // Archive
  const archiveCases = filterCases(query, data.archive).slice().reverse();
  const archiveEl = document.getElementById('work-archive');
  if (archiveEl) {
    archiveEl.innerHTML = archiveCases.map(c => renderCaseCard(c, true)).join('');
    const countEl = document.getElementById('work-archive-count');
    if (countEl) countEl.textContent = data.archive.length;
  }
}

// ── Render Helpers ─────────────────────────────────────────────
function renderGroupSection(id, label, extraCls, content, count, defaultOpen) {
  return `
    <details class="group-section" id="group-${id}" ${defaultOpen ? 'open' : ''}>
      <summary class="group-header ${extraCls}">
        <span class="group-label">${label}</span>
        <span class="group-count">${count}</span>
      </summary>
      <div class="group-content">
        ${content || '<p class="empty-group">Nothing here</p>'}
      </div>
    </details>`;
}

function renderDueBadge(due_date) {
  if (!due_date) return '';
  const info = formatDueDate(due_date);
  if (!info) return '';
  return `<span class="due-label ${info.cls}">${info.text}</span>`;
}

function renderPriorityBadge(priority) {
  const pc = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal;
  return `<span class="priority-badge" style="background:${pc.color}">${pc.label}</span>`;
}

function renderTaskCard(task, section, isArchived) {
  const notes = task.notes
    ? `<p class="card-notes">${escapeHtml(task.notes)}</p>` : '';
  const updated = task.updated_at
    ? `<span class="card-meta">Edited ${formatDate(task.updated_at)}</span>` : '';
  const dateLabel = isArchived
    ? `Completed ${formatDate(task.completed_at)}`
    : `Added ${formatDate(task.created_at)}`;

  return `
    <div class="task-card${isArchived ? ' archived' : ''}" data-id="${task.id}" data-section="${section}">
      <button class="card-checkbox${isArchived ? ' checked' : ''}"
              data-action="complete-task"
              ${isArchived ? 'disabled' : ''}
              aria-label="Mark complete">
        ${isArchived ? '&#10003;' : ''}
      </button>
      <div class="card-body">
        <div class="card-header-row">
          ${renderPriorityBadge(task.priority)}
          ${renderDueBadge(task.due_date)}
          ${!isArchived ? `<button class="icon-btn edit-btn" data-action="edit-task" aria-label="Edit task">&#9998;</button>` : ''}
        </div>
        <p class="card-title${isArchived ? ' strikethrough' : ''}">${escapeHtml(task.title)}</p>
        ${notes}
        <div class="card-footer">
          <span class="card-meta">${dateLabel}</span>
          ${updated}
        </div>
      </div>
    </div>`;
}

function renderCaseCard(caseObj, isArchived) {
  const pc = PRIORITY_CONFIG[caseObj.priority] || PRIORITY_CONFIG.normal;
  const pendingEv = caseObj.evidence.filter(e => !e.completed).length;
  const totalEv   = caseObj.evidence.length;
  const evHtml    = caseObj.evidence.map(ev => renderEvidenceItem(ev, caseObj.id, isArchived)).join('');

  const completedInfo = isArchived
    ? `<span class="case-submitted">Completed: ${formatDate(caseObj.completed_at)}</span>` : '';

  return `
    <div class="case-card${isArchived ? ' archived' : ''}" data-id="${caseObj.id}">
      <div class="case-header">
        <div class="case-header-row">
          ${renderPriorityBadge(caseObj.priority)}
          ${renderDueBadge(caseObj.due_date)}
          <span class="case-number">${escapeHtml(caseObj.case_number)}</span>
          ${!isArchived ? `<button class="icon-btn edit-btn" data-action="edit-case" aria-label="Edit case">&#9998;</button>` : ''}
        </div>
        <div class="case-meta-row">
          <span class="case-field">${escapeHtml(caseObj.submitting_agency)}</span>
          <span class="separator">&#183;</span>
          <span class="case-field">${escapeHtml(caseObj.case_agent)}</span>
        </div>
      </div>
      ${caseObj.synopsis ? `<p class="case-synopsis">${escapeHtml(caseObj.synopsis)}</p>` : ''}
      <p class="case-submitted">Submitted: ${formatDate(caseObj.submitted_at)}</p>
      ${completedInfo}
      ${!isArchived ? `<button class="btn-complete-case" data-action="complete-case" aria-label="Complete and archive case">&#10003; Complete Case</button>` : ''}
      <div class="evidence-header-row">
        <details class="evidence-section">
        <summary class="evidence-summary">
          <span>Evidence</span>
          <span class="ev-count">(${totalEv - pendingEv}/${totalEv} done)</span>
        </summary>
        <div class="evidence-list" data-case-id="${caseObj.id}">
          ${evHtml || '<p class="empty-group">No evidence logged yet</p>'}
        </div>
      </details>
      ${!isArchived ? `<button class="btn-add-evidence" data-action="add-evidence" aria-label="Add evidence item">+ Add Evidence</button>` : ''}
      </div>
    </div>`;
}

function renderEvidenceItem(ev, caseId, isArchived) {
  const showDelete = !isArchived && !ev.completed;
  return `
    <div class="evidence-item${ev.completed ? ' ev-done' : ''}" data-id="${ev.id}" data-case-id="${caseId}">
      <button class="ev-checkbox${ev.completed ? ' checked' : ''}"
              data-action="complete-evidence"
              ${ev.completed ? 'disabled' : ''}
              aria-label="Mark evidence done">
        ${ev.completed ? '&#10003;' : ''}
      </button>
      <div class="ev-body">
        <span class="ev-desc${ev.completed ? ' strikethrough' : ''}">${escapeHtml(ev.description)}</span>
        ${ev.notes ? `<span class="ev-notes">${escapeHtml(ev.notes)}</span>` : ''}
      </div>
      ${showDelete ? `<button class="icon-btn trash-btn" data-action="delete-evidence" aria-label="Remove evidence">&#128465;</button>` : ''}
    </div>`;
}

// ── Form HTML Builders ─────────────────────────────────────────
function priorityOptions(selected) {
  return Object.entries(PRIORITY_CONFIG)
    .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${v.label}</option>`)
    .join('');
}

function statusOptions(selected) {
  return [
    ['active',     'Active'],
    ['on_hold',    'On Hold'],
    ['backlogged', 'Backlogged'],
  ].map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
}

function taskFormHtml(existing = {}) {
  return `
    <div class="form-group">
      <label for="f-title">Title *</label>
      <input id="f-title" type="text" value="${escapeHtml(existing.title || '')}" placeholder="Task title" autocorrect="on">
    </div>
    <div class="form-group">
      <label for="f-notes">Notes</label>
      <textarea id="f-notes" placeholder="Optional notes or ideas...">${escapeHtml(existing.notes || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="f-priority">Priority</label>
        <select id="f-priority">${priorityOptions(existing.priority || 'normal')}</select>
      </div>
      <div class="form-group">
        <label for="f-status">Status</label>
        <select id="f-status">${statusOptions(existing.status || 'active')}</select>
      </div>
    </div>
    <div class="form-group">
      <label for="f-due-date">Due Date</label>
      <input id="f-due-date" type="date" value="${existing.due_date || ''}">
    </div>`;
}

function caseFormHtml(existing = {}) {
  const submittedDate = existing.submitted_at
    ? existing.submitted_at.slice(0, 10)
    : getTodayStr();
  return `
    <div class="form-group">
      <label for="f-case-number">Case Number *</label>
      <input id="f-case-number" type="text" value="${escapeHtml(existing.case_number || '')}" placeholder="e.g. 2024-001" autocorrect="off" autocapitalize="characters">
    </div>
    <div class="form-group">
      <label for="f-agency">Submitting Agency *</label>
      <input id="f-agency" type="text" value="${escapeHtml(existing.submitting_agency || '')}" placeholder="e.g. SBSO" autocorrect="off">
    </div>
    <div class="form-group">
      <label for="f-agent">Case Agent *</label>
      <input id="f-agent" type="text" value="${escapeHtml(existing.case_agent || '')}" placeholder="e.g. Det. Smith">
    </div>
    <div class="form-group">
      <label for="f-synopsis">Synopsis</label>
      <textarea id="f-synopsis" placeholder="Brief description of the case...">${escapeHtml(existing.synopsis || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="f-priority">Priority</label>
        <select id="f-priority">${priorityOptions(existing.priority || 'normal')}</select>
      </div>
      <div class="form-group">
        <label for="f-status">Status</label>
        <select id="f-status">${statusOptions(existing.status || 'active')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="f-submitted">Date Submitted</label>
        <input id="f-submitted" type="date" value="${submittedDate}">
      </div>
      <div class="form-group">
        <label for="f-due-date">Due Date</label>
        <input id="f-due-date" type="date" value="${existing.due_date || ''}">
      </div>
    </div>`;
}

function evidenceFormHtml(existing = {}) {
  return `
    <div class="form-group">
      <label for="f-ev-desc">Description *</label>
      <input id="f-ev-desc" type="text" value="${escapeHtml(existing.description || '')}"
             placeholder="e.g. iPhone 15 Pro, black, cracked screen">
    </div>
    <div class="form-group">
      <label for="f-ev-notes">Notes</label>
      <textarea id="f-ev-notes" rows="2" placeholder="Chain of custody, condition, tracking number...">${escapeHtml(existing.notes || '')}</textarea>
    </div>`;
}

// ── Modal System ───────────────────────────────────────────────
function showModal(title, bodyHtml, onSave, saveBtnLabel = 'Save') {
  const overlay   = document.getElementById('modal-overlay');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const saveBtn   = document.getElementById('modal-save');

  titleEl.textContent = title;
  bodyEl.innerHTML    = bodyHtml;
  saveBtn.textContent = saveBtnLabel;
  saveBtn.disabled    = false;
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  // Auto-focus first input
  requestAnimationFrame(() => {
    const first = bodyEl.querySelector('input, textarea, select');
    if (first) first.focus();
  });

  // Wire up save — clone to remove any previous listeners
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  newSave.addEventListener('click', async () => {
    newSave.disabled    = true;
    newSave.textContent = 'Saving…';
    try {
      await onSave();
      hideModal();
    } catch (err) {
      showToast(err.message, 'error');
      newSave.disabled    = false;
      newSave.textContent = saveBtnLabel;
    }
  });
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
}

// ── Modal Launchers ────────────────────────────────────────────
function showAddTaskModal(section) {
  const label = CATEGORIES[section].label;
  showModal(`Add ${label} Task`, taskFormHtml(), async () => {
    const title = document.getElementById('f-title').value.trim();
    if (!title) throw new Error('Title is required');
    await addTask(section, {
      title,
      notes:    document.getElementById('f-notes').value,
      priority: document.getElementById('f-priority').value,
      status:   document.getElementById('f-status').value,
      dueDate:  document.getElementById('f-due-date').value || null,
    });
  });
}

function showEditTaskModal(section, task) {
  showModal('Edit Task', taskFormHtml(task), async () => {
    const title = document.getElementById('f-title').value.trim();
    if (!title) throw new Error('Title is required');
    await editTask(section, task.id, {
      title,
      notes:    document.getElementById('f-notes').value,
      priority: document.getElementById('f-priority').value,
      status:   document.getElementById('f-status').value,
      due_date: document.getElementById('f-due-date').value || null,
    });
  });
}

function showAddCaseModal() {
  showModal('Add Work Case', caseFormHtml(), async () => {
    const caseNumber = document.getElementById('f-case-number').value.trim();
    const agency     = document.getElementById('f-agency').value.trim();
    const agent      = document.getElementById('f-agent').value.trim();
    if (!caseNumber || !agency || !agent) {
      throw new Error('Case number, agency, and agent are required');
    }
    const submittedVal = document.getElementById('f-submitted').value;
    await addCase({
      caseNumber,
      agency,
      agent,
      synopsis:    document.getElementById('f-synopsis').value,
      priority:    document.getElementById('f-priority').value,
      status:      document.getElementById('f-status').value,
      dueDate:     document.getElementById('f-due-date').value || null,
      submittedAt: submittedVal
        ? new Date(submittedVal + 'T12:00:00').toISOString()
        : new Date().toISOString(),
    });
  });
}

function showEditCaseModal(caseObj) {
  showModal('Edit Case', caseFormHtml(caseObj), async () => {
    const caseNumber = document.getElementById('f-case-number').value.trim();
    const agency     = document.getElementById('f-agency').value.trim();
    const agent      = document.getElementById('f-agent').value.trim();
    if (!caseNumber || !agency || !agent) {
      throw new Error('Case number, agency, and agent are required');
    }
    const submittedVal = document.getElementById('f-submitted').value;
    await editCase(caseObj.id, {
      case_number:       caseNumber,
      submitting_agency: agency,
      case_agent:        agent,
      synopsis:          document.getElementById('f-synopsis').value,
      priority:          document.getElementById('f-priority').value,
      status:            document.getElementById('f-status').value,
      due_date:          document.getElementById('f-due-date').value || null,
      submitted_at:      submittedVal
        ? new Date(submittedVal + 'T12:00:00').toISOString()
        : caseObj.submitted_at,
    });
  });
}

function showAddEvidenceModal(caseId) {
  showModal('Add Evidence', evidenceFormHtml(), async () => {
    const description = document.getElementById('f-ev-desc').value.trim();
    if (!description) throw new Error('Description is required');
    await addEvidence(caseId, {
      description,
      notes: document.getElementById('f-ev-notes').value,
    });
  });
}

// ── Task CRUD ──────────────────────────────────────────────────
async function addTask(section, { title, notes, priority, status, dueDate }) {
  const task = {
    id:          generateId(),
    title:       title.trim(),
    notes:       (notes || '').trim(),
    priority:    priority || 'normal',
    status:      status   || 'active',
    due_date:    dueDate  || null,
    created_at:  new Date().toISOString(),
    updated_at:  null,
    completed:   false,
    completed_at: null,
  };
  STATE.data[section].tasks.push(task);
  await saveSection(section, `Add task: ${task.title}`);
  renderSection(section);
  showToast('Task added', 'success');
}

async function editTask(section, taskId, updates) {
  const task = STATE.data[section].tasks.find(t => t.id === taskId);
  if (!task) return;
  Object.assign(task, updates);
  task.updated_at = new Date().toISOString();
  await saveSection(section, `Update task: ${task.title}`);
  renderSection(section);
  showToast('Task updated', 'success');
}

async function completeTask(section, taskId) {
  const data = STATE.data[section];
  const idx  = data.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  const task     = data.tasks[idx];
  task.completed = true;
  task.completed_at = new Date().toISOString();
  data.archive.push(task);
  data.tasks.splice(idx, 1);
  await saveSection(section, `Complete task: ${task.title}`);
  renderSection(section);
  showToast('Task completed ✓', 'success');
}

// ── Case CRUD ──────────────────────────────────────────────────
async function addCase({ caseNumber, agency, agent, synopsis, priority, status, dueDate, submittedAt }) {
  const newCase = {
    id:               generateId(),
    case_number:      caseNumber.trim(),
    submitting_agency: agency.trim(),
    case_agent:       agent.trim(),
    synopsis:         (synopsis || '').trim(),
    priority:         priority    || 'normal',
    status:           status      || 'active',
    due_date:         dueDate     || null,
    submitted_at:     submittedAt || new Date().toISOString(),
    updated_at:       null,
    completed:        false,
    completed_at:     null,
    evidence:         [],
  };
  STATE.data.work.cases.push(newCase);
  await saveSection('work', `Add case: ${caseNumber}`);
  renderSection('work');
  showToast('Case added', 'success');
}

async function editCase(caseId, updates) {
  const caseObj = STATE.data.work.cases.find(c => c.id === caseId);
  if (!caseObj) return;
  Object.assign(caseObj, updates);
  caseObj.updated_at = new Date().toISOString();
  await saveSection('work', `Update case: ${caseObj.case_number}`);
  renderSection('work');
  showToast('Case updated', 'success');
}

async function addEvidence(caseId, { description, notes }) {
  const caseObj = STATE.data.work.cases.find(c => c.id === caseId);
  if (!caseObj) return;
  caseObj.evidence.push({
    id:          generateId(),
    description: description.trim(),
    notes:       (notes || '').trim(),
    completed:   false,
    completed_at: null,
  });
  await saveSection('work', `Add evidence to case ${caseObj.case_number}`);
  renderSection('work');
  showToast('Evidence added', 'success');
}

async function deleteEvidence(caseId, evidenceId) {
  const caseObj = STATE.data.work.cases.find(c => c.id === caseId);
  if (!caseObj) return;
  const idx = caseObj.evidence.findIndex(e => e.id === evidenceId);
  if (idx === -1) return;
  caseObj.evidence.splice(idx, 1);
  await saveSection('work', `Remove evidence from case ${caseObj.case_number}`);
  renderSection('work');
  showToast('Evidence removed');
}

async function completeEvidence(caseId, evidenceId) {
  const caseObj = STATE.data.work.cases.find(c => c.id === caseId);
  if (!caseObj) return;
  const ev = caseObj.evidence.find(e => e.id === evidenceId);
  if (!ev || ev.completed) return;
  ev.completed    = true;
  ev.completed_at = new Date().toISOString();
  await saveSection('work', `Complete evidence on case ${caseObj.case_number}`);
  renderSection('work');
  showToast('Evidence checked ✓', 'success');
}

async function completeCase(caseId) {
  const data = STATE.data.work;
  const idx  = data.cases.findIndex(c => c.id === caseId);
  if (idx === -1) return;
  const caseObj = data.cases[idx];
  const now     = new Date().toISOString();
  caseObj.evidence.forEach(ev => {
    if (!ev.completed) { ev.completed = true; ev.completed_at = now; }
  });
  caseObj.completed    = true;
  caseObj.completed_at = now;
  data.archive.push(caseObj);
  data.cases.splice(idx, 1);
  await saveSection('work', `Complete case: ${caseObj.case_number}`);
  renderSection('work');
  showToast(`Case ${caseObj.case_number} archived ✓`, 'success');
}

// ── Tab Navigation ─────────────────────────────────────────────
function switchTab(tabName) {
  STATE.activeTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.toggle('active', view.id === `${tabName}-view`);
  });

  // Lazy-load data on first visit to a tab
  if (tabName !== 'settings' && STATE.data[tabName] === null) {
    if (hasSettings()) {
      loadSection(tabName);
    } else {
      showToast('Please configure GitHub settings first', 'warning');
      switchTab('settings');
    }
  }
}

// ── Event Delegation ───────────────────────────────────────────
function handleTaskViewClick(section) {
  return (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const card   = target.closest('[data-id]');
    if (!card) return;
    const id     = card.dataset.id;
    const action = target.dataset.action;

    if (action === 'complete-task') {
      completeTask(section, id);
    } else if (action === 'edit-task') {
      const task = STATE.data[section]?.tasks.find(t => t.id === id);
      if (task) showEditTaskModal(section, task);
    }
  };
}

function handleWorkViewClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'add-evidence') {
    // Stop the <details> summary from toggling when the button is inside it
    e.stopPropagation();
    e.preventDefault();
    const caseCard = target.closest('[data-id]');
    if (caseCard) showAddEvidenceModal(caseCard.dataset.id);
    return;
  }

  if (action === 'edit-case') {
    const caseCard = target.closest('[data-id]');
    if (!caseCard) return;
    const caseObj = STATE.data.work?.cases.find(c => c.id === caseCard.dataset.id);
    if (caseObj) showEditCaseModal(caseObj);
    return;
  }

  if (action === 'complete-case') {
    const caseCard = target.closest('[data-id]');
    if (!caseCard) return;
    const caseObj = STATE.data.work?.cases.find(c => c.id === caseCard.dataset.id);
    if (!caseObj) return;
    const pendingEv = caseObj.evidence.filter(e => !e.completed).length;
    const msg = pendingEv > 0
      ? `Complete case ${caseObj.case_number}? This will also mark ${pendingEv} pending evidence item(s) as done and move the case to the archive.`
      : `Complete case ${caseObj.case_number} and move it to the archive?`;
    if (confirm(msg)) completeCase(caseCard.dataset.id);
    return;
  }

  if (action === 'complete-evidence') {
    const item = target.closest('.evidence-item');
    if (!item) return;
    completeEvidence(item.dataset.caseId, item.dataset.id);
    return;
  }

  if (action === 'delete-evidence') {
    const item = target.closest('.evidence-item');
    if (!item) return;
    const desc = item.querySelector('.ev-desc')?.textContent || 'this item';
    if (confirm(`Remove evidence: "${desc}"?`)) {
      deleteEvidence(item.dataset.caseId, item.dataset.id);
    }
  }
}

// ── Event Listener Setup ───────────────────────────────────────
function setupEventListeners() {
  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Add buttons
  document.getElementById('add-personal').addEventListener('click', () => showAddTaskModal('personal'));
  document.getElementById('add-church').addEventListener('click',   () => showAddTaskModal('church'));
  document.getElementById('add-work').addEventListener('click',     showAddCaseModal);

  // Work search (debounced slightly)
  const searchInput = document.getElementById('work-search');
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      STATE.searchQuery = searchInput.value;
      if (STATE.data.work) renderSection('work');
    }, 180);
  });

  // Clear search on 'X' button in type="search"
  searchInput.addEventListener('search', () => {
    STATE.searchQuery = searchInput.value;
    if (STATE.data.work) renderSection('work');
  });

  // Settings save
  document.getElementById('save-settings').addEventListener('click', () => {
    const owner = document.getElementById('gh-owner').value.trim();
    const repo  = document.getElementById('gh-repo').value.trim();
    const token = document.getElementById('gh-token').value.trim();
    if (!owner || !repo || !token) {
      showToast('All three fields are required', 'error');
      return;
    }
    saveSettings(owner, repo, token);
    showToast('Settings saved', 'success');
  });

  // Settings test connection
  document.getElementById('test-connection').addEventListener('click', async () => {
    if (!hasSettings()) {
      showToast('Please save settings first', 'warning');
      return;
    }
    setLoading(true);
    try {
      await githubGet(CATEGORIES.personal.file);
      showToast('Connection successful!', 'success');
    } catch (err) {
      showToast(`Connection failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click',  hideModal);
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') hideModal();
  });

  // Close modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideModal();
  });

  // Task tab event delegation
  document.getElementById('personal-view').addEventListener('click', handleTaskViewClick('personal'));
  document.getElementById('church-view').addEventListener('click',   handleTaskViewClick('church'));

  // Work tab event delegation
  document.getElementById('work-view').addEventListener('click', handleWorkViewClick);
}

// ── Service Worker Registration ────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
      .catch(err => console.warn('SW registration failed:', err));
  }
}

// ── App Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
  registerServiceWorker();

  // Populate settings fields from stored values
  document.getElementById('gh-owner').value = STATE.settings.owner;
  document.getElementById('gh-repo').value  = STATE.settings.repo;
  document.getElementById('gh-token').value = STATE.settings.token;

  if (hasSettings()) {
    switchTab('personal');
    // Preload all sections in background
    preloadAllSections();
  } else {
    switchTab('settings');
    showToast('Welcome, Sully! Please configure your GitHub settings to get started.', 'info');
  }
});
