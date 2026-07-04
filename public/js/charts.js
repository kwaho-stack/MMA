// 경량 SVG 차트 — 라인(수익 추이), 가로 바(플랫폼별), 스파크라인.
// 스펙: 2px 라인, 10% 영역 워시, 헤어라인 그리드, 4px 라운드 데이터엔드(베이스라인은 직각),
//       ≥8px 엔드 마커 + 서피스 링, 호버 크로스헤어/툴팁, 값 라벨은 텍스트 토큰.

const CHART = {
  surface: '#1a1a19',
  grid: '#2c2c2a',
  baseline: '#383835',
  muted: '#898781',
  text2: '#c3c2b7',
  blue: '#3987e5',
};

const _tt = () => document.getElementById('chart-tooltip');

function showTooltip(html, x, y) {
  const tt = _tt();
  tt.innerHTML = html;
  tt.hidden = false;
  const pad = 14;
  const rect = tt.getBoundingClientRect();
  let left = x + pad, top = y - rect.height - 10;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top < 8) top = y + pad;
  tt.style.left = `${left}px`;
  tt.style.top = `${top}px`;
}
function hideTooltip() { _tt().hidden = true; }

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].find((u) => rough / pow <= u) * pow;
  const top = Math.ceil(max / unit) * unit;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += unit) ticks.push(v);
  return ticks;
}

/** 라인 차트 (단일 시리즈 — 범례 없음, 제목이 시리즈를 지칭) */
function renderLineChart(container, { points, color = CHART.blue, height = 230, formatValue = (v) => v, title = '' }) {
  container.innerHTML = '';
  if (!points || points.length < 2) {
    container.innerHTML = '<div class="empty">데이터가 부족합니다</div>';
    return;
  }
  const width = container.clientWidth || 600;
  const padL = 52, padR = 24, padT = 14, padB = 26;
  const w = width - padL - padR, h = height - padT - padB;
  const max = Math.max(...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const X = (i) => padL + (i / (points.length - 1)) * w;
  const Y = (v) => padT + h - (v / top) * h;

  let grid = '', labels = '';
  for (const t of ticks) {
    grid += `<line x1="${padL}" y1="${Y(t)}" x2="${padL + w}" y2="${Y(t)}" stroke="${t === 0 ? CHART.baseline : CHART.grid}" stroke-width="1"/>`;
    labels += `<text x="${padL - 8}" y="${Y(t) + 4}" text-anchor="end" fill="${CHART.muted}" font-size="10.5" style="font-variant-numeric:tabular-nums">${formatValue(t)}</text>`;
  }
  const xStep = Math.max(1, Math.ceil(points.length / 6));
  for (let i = 0; i < points.length; i += xStep) {
    labels += `<text x="${X(i)}" y="${padT + h + 17}" text-anchor="middle" fill="${CHART.muted}" font-size="10.5">${points[i].label}</text>`;
  }

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${X(points.length - 1).toFixed(1)},${Y(0)} L${X(0).toFixed(1)},${Y(0)} Z`;
  const last = points[points.length - 1];
  const endX = X(points.length - 1), endY = Y(last.value);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    ${grid}${labels}
    <path d="${areaPath}" fill="${color}" opacity="0.1"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${endX}" cy="${endY}" r="6" fill="${CHART.surface}"/>
    <circle cx="${endX}" cy="${endY}" r="4" fill="${color}"/>
    <text x="${endX - 4}" y="${endY - 11}" text-anchor="end" fill="${CHART.text2}" font-size="11" font-weight="600" style="font-variant-numeric:tabular-nums">${formatValue(last.value)}</text>
    <line class="xhair" x1="0" y1="${padT}" x2="0" y2="${padT + h}" stroke="${CHART.baseline}" stroke-width="1" visibility="hidden"/>
    <circle class="xdot-ring" r="7" fill="${CHART.surface}" visibility="hidden"/>
    <circle class="xdot" r="4.5" fill="${color}" visibility="hidden"/>
    <rect class="hover-zone" x="${padL}" y="${padT}" width="${w}" height="${h}" fill="transparent"/>
  `;
  container.appendChild(svg);

  const xhair = svg.querySelector('.xhair');
  const xdot = svg.querySelector('.xdot');
  const xring = svg.querySelector('.xdot-ring');
  const zone = svg.querySelector('.hover-zone');
  zone.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const scale = width / rect.width;
    const mx = (e.clientX - rect.left) * scale;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((mx - padL) / w) * (points.length - 1))));
    const px = X(i), py = Y(points[i].value);
    xhair.setAttribute('x1', px); xhair.setAttribute('x2', px);
    xhair.removeAttribute('visibility');
    xring.setAttribute('cx', px); xring.setAttribute('cy', py); xring.removeAttribute('visibility');
    xdot.setAttribute('cx', px); xdot.setAttribute('cy', py); xdot.removeAttribute('visibility');
    showTooltip(
      `<div class="tt-title">${esc(points[i].fullLabel || points[i].label)}</div>
       <div class="tt-row"><span class="tt-swatch" style="background:${color}"></span>${title ? `${esc(title)} ` : ''}<b>${formatValue(points[i].value)}</b></div>`,
      e.clientX, e.clientY,
    );
  });
  zone.addEventListener('mouseleave', () => {
    xhair.setAttribute('visibility', 'hidden');
    xdot.setAttribute('visibility', 'hidden');
    xring.setAttribute('visibility', 'hidden');
    hideTooltip();
  });
}

/** 가로 바 차트 — 항목별 고정 색(엔티티 고정), 값 라벨은 바 끝 바깥 텍스트 토큰 */
function renderBarChart(container, { items, formatValue = (v) => v, barH = 20, gap = 12 }) {
  container.innerHTML = '';
  if (!items || !items.length) {
    container.innerHTML = '<div class="empty">데이터가 없습니다</div>';
    return;
  }
  const width = container.clientWidth || 600;
  const labelW = 128, valueW = 74, padT = 6;
  const w = width - labelW - valueW - 16;
  const height = padT * 2 + items.length * (barH + gap) - gap;
  const max = Math.max(...items.map((it) => it.value), 1);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  let inner = `<line x1="${labelW}" y1="${padT - 2}" x2="${labelW}" y2="${height - padT + 2}" stroke="${CHART.baseline}" stroke-width="1"/>`;
  items.forEach((it, idx) => {
    const y = padT + idx * (barH + gap);
    const bw = Math.max(2, (it.value / max) * w);
    const r = Math.min(4, bw / 2);
    // 데이터 엔드만 4px 라운드, 베이스라인 쪽은 직각
    const path = `M${labelW},${y} h${bw - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${bw - r} Z`;
    inner += `
      <text x="${labelW - 10}" y="${y + barH / 2 + 4}" text-anchor="end" fill="${CHART.text2}" font-size="12">${esc(it.label)}</text>
      <path d="${path}" fill="${it.color || CHART.blue}" class="bar-mark" data-i="${idx}"/>
      <text x="${labelW + bw + 8}" y="${y + barH / 2 + 4}" fill="${CHART.text2}" font-size="11.5" font-weight="600" style="font-variant-numeric:tabular-nums">${formatValue(it.value)}</text>
      <rect x="0" y="${y - gap / 2}" width="${width}" height="${barH + gap}" fill="transparent" class="bar-hit" data-i="${idx}"/>`;
  });
  svg.innerHTML = inner;
  container.appendChild(svg);

  svg.querySelectorAll('.bar-hit').forEach((hit) => {
    hit.addEventListener('mousemove', (e) => {
      const it = items[Number(hit.dataset.i)];
      showTooltip(
        `<div class="tt-title">${esc(it.sub || '')}</div>
         <div class="tt-row"><span class="tt-swatch" style="background:${it.color || CHART.blue}"></span>${esc(it.label)} <b>${formatValue(it.value)}</b></div>`,
        e.clientX, e.clientY,
      );
    });
    hit.addEventListener('mouseleave', hideTooltip);
  });
}

/** 12포인트 스파크라인 (스탯 타일용) — 문자열 SVG 반환 */
function sparklineSVG(values, { width = 84, height = 26, color = CHART.blue } = {}) {
  if (!values || values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const X = (i) => 2 + (i / (values.length - 1)) * (width - 8);
  const Y = (v) => 2 + (height - 6) - ((v - min) / span) * (height - 6);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const lx = X(values.length - 1), ly = Y(values[values.length - 1]);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
    <circle cx="${lx}" cy="${ly}" r="2.5" fill="${color}"/>
  </svg>`;
}
