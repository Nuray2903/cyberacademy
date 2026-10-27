// Shared helpers for all CyberAcademy pages

async function api(url, options = {}) {
  const opts = { credentials: 'same-origin', headers: {}, ...options };
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON response */ }
  if (res.status === 401 && !location.pathname.endsWith('index.html') && location.pathname !== '/') {
    location.href = '/index.html';
    throw new Error('Not logged in');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal, safe markdown renderer (headings, ordered lists, bullets, bold, inline code)
function renderMarkdown(src) {
  const lines = String(src).split('\n');
  let html = '';
  let list = null;

  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  const closeList = () => {
    if (list) { html += `</${list}>`; list = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^##\s+(.*)/))) {
      closeList();
      html += `<h2>${inline(m[1])}</h2>`;
    } else if ((m = line.match(/^\d+\.\s+(.*)/))) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^[-*]\s+(.*)/))) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (/^\s+\S/.test(line) && list) {
      // continuation line of the previous list item
      html = html.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

async function renderNav(active) {
  const links = [
    ['dashboard.html', 'Dashboard'],
    ['labs.html', 'Labs'],
    ['leaderboard.html', 'Leaderboard']
  ];
  let username = '';
  try {
    const me = await api('/api/me');
    username = me.user.username;
  } catch (e) { return; }

  const nav = document.getElementById('nav');
  nav.className = 'nav';
  nav.innerHTML = `
    <a class="brand" href="dashboard.html">Cyber<span>Academy</span></a>
    <div class="nav-links">
      ${links.map(([href, label]) => `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`).join('')}
    </div>
    <div class="nav-user">
      <span>${esc(username)}</span>
      <button class="btn ghost" id="logout-btn">Log out</button>
    </div>`;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/index.html';
  });
}

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className = 'msg show ' + (ok ? 'ok' : 'err');
}
