// API 클라이언트 + 공용 헬퍼
const API = {
  async req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data;
  },
  get: (url) => API.req('GET', url),
  post: (url, body) => API.req('POST', url, body),
  put: (url, body) => API.req('PUT', url, body),
  del: (url) => API.req('DELETE', url),
};

// 숫자 포맷
const fmt = {
  won(n) {
    n = Math.round(Number(n) || 0);
    if (Math.abs(n) >= 100000000) return `₩${(n / 100000000).toFixed(1)}억`;
    if (Math.abs(n) >= 10000) return `₩${(n / 10000).toFixed(1)}만`;
    return `₩${n.toLocaleString('ko-KR')}`;
  },
  wonFull(n) { return `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`; },
  num(n) { return Number(n || 0).toLocaleString('ko-KR'); },
  date(s) {
    if (!s) return '-';
    const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') : `${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) return s;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },
  datetime(s) {
    if (!s) return '-';
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return s;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, kind = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 4200);
}

function openModal({ title, body, wide = false, footer = '' }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal ${wide ? 'wide' : ''}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x" data-close>✕</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;
  root.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay') || e.target.hasAttribute('data-close')) closeModal();
  });
  return root;
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

// 상태 라벨 매핑
const STATUS_LABEL = {
  generating: ['원고 생성 중', 'badge-info'],
  rewriting: ['리라이팅 중', 'badge-info'],
  ready: ['승인 대기', 'badge-warn'],
  approved: ['승인됨', 'badge-info'],
  scheduled: ['발행 예약', 'badge-violet'],
  publishing: ['발행 진행 중', 'badge-info'],
  published: ['발행 완료', 'badge-ok'],
  manual: ['수동 발행 대기', 'badge-warn'],
  failed: ['실패', 'badge-danger'],
  rejected: ['반려됨', 'badge-danger'],
  pending: ['대기', ''],
};
function statusBadge(status) {
  const [label, cls] = STATUS_LABEL[status] || [status, ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

// 광고 플랫폼별 고정 색 (카테고리컬 — 순서 고정, 순환 금지)
const AD_COLORS = {
  adsense: 'var(--s1)', adpost: 'var(--s2)', adfit: 'var(--s3)',
  coupang_partners: 'var(--s4)', taboola: 'var(--s5)', dable: 'var(--s6)',
  creator_rewards: 'var(--s7)', youtube_partner: 'var(--s1)', tenping: 'var(--s2)',
};
