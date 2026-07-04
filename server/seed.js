// 데모 시드 — 첫 실행 시 카테고리·계정·매칭·주제·발행 이력·수익 데이터를 넣어
// 대시보드가 바로 살아있는 상태로 보이게 한다. (모든 데이터는 데모이며 삭제/수정 가능)

const { db, setSetting, log } = require('./db');

function seeded() {
  return db.prepare('SELECT COUNT(*) AS n FROM categories').get().n > 0;
}

// 결정적 의사난수(시드 고정) — 실행할 때마다 같은 데모 수치가 나온다.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run() {
  if (seeded()) return false;
  const rand = mulberry32(20260704);

  const cat = db.prepare('INSERT INTO categories(name, description, color, auto_enabled) VALUES(?,?,?,?)');
  const issueId = Number(cat.run('이슈', '실시간 이슈·트렌드·화제성 콘텐츠. 빠른 발행이 생명.', '#e66767', 0).lastInsertRowid);
  const lifeId = Number(cat.run('생활정보', '생활 꿀팁·리뷰·정책 정보. 검색 유입 중심의 스테디셀러.', '#199e70', 0).lastInsertRowid);
  const moneyId = Number(cat.run('재테크', '절약·금융 정보·정부지원금. 고단가 키워드 카테고리.', '#c98500', 0).lastInsertRowid);

  const acc = db.prepare('INSERT INTO media_accounts(platform, name, category_id, url) VALUES(?,?,?,?)');
  const accounts = [
    ['blogger', '이슈스팟 (Blogger)', issueId, 'https://issuespot.blogspot.com'],
    ['tistory', '오늘이슈 티스토리', issueId, 'https://todayissue.tistory.com'],
    ['instagram', '@issue.card 인스타', issueId, 'https://instagram.com/issue.card'],
    ['threads', '@issue.card 스레드', issueId, ''],
    ['naver_blog', '생활의발견 네이버', lifeId, 'https://blog.naver.com/lifehack'],
    ['tistory', '살림백서 티스토리', lifeId, 'https://livingbook.tistory.com'],
    ['blogger', 'LifeTip (Blogger)', lifeId, 'https://lifetipkr.blogspot.com'],
    ['youtube', '생활정보 쇼츠 채널', lifeId, ''],
    ['wordpress', '머니레터 (워드프레스)', moneyId, 'https://moneyletter.co.kr'],
    ['naver_blog', '짠테크연구소 네이버', moneyId, 'https://blog.naver.com/zzantech'],
    ['x_twitter', '@money_letter X', moneyId, ''],
    ['tiktok', '@moneyshorts 틱톡', moneyId, ''],
  ];
  const accIds = accounts.map((a) => Number(acc.run(...a).lastInsertRowid));

  const ad = db.prepare('INSERT INTO ad_accounts(platform, name, status) VALUES(?,?,?)');
  const adsense = Number(ad.run('adsense', '애드센스 (pub-데모)', 'active').lastInsertRowid);
  const adpost = Number(ad.run('adpost', '네이버 애드포스트', 'active').lastInsertRowid);
  const adfit = Number(ad.run('adfit', '카카오 애드핏', 'active').lastInsertRowid);
  const coupang = Number(ad.run('coupang_partners', '쿠팡 파트너스', 'active').lastInsertRowid);
  const taboola = Number(ad.run('taboola', '타불라', 'pending').lastInsertRowid);
  const dable = Number(ad.run('dable', '데이블', 'active').lastInsertRowid);

  const match = db.prepare('INSERT OR IGNORE INTO matchings(media_account_id, ad_account_id, note) VALUES(?,?,?)');
  // Blogger/티스토리/워드프레스 → 애드센스, 네이버 → 애드포스트, 티스토리 → 애드핏 병행, 블로그 전반 → 쿠팡
  const byPlatform = Object.fromEntries(accounts.map((a, i) => [accIds[i], a[0]]));
  for (const [id, platform] of Object.entries(byPlatform)) {
    const mid = Number(id);
    if (['blogger', 'tistory', 'wordpress'].includes(platform)) match.run(mid, adsense, '메인 수익원');
    if (platform === 'naver_blog') match.run(mid, adpost, '');
    if (platform === 'tistory') match.run(mid, adfit, '애드센스와 병행');
    if (['blogger', 'naver_blog', 'tistory', 'wordpress', 'instagram', 'threads', 'x_twitter'].includes(platform)) {
      match.run(mid, coupang, '제휴 링크');
    }
    if (platform === 'wordpress') { match.run(mid, taboola, '트래픽 조건 심사 중'); match.run(mid, dable, ''); }
  }

  const topic = db.prepare('INSERT INTO topics(category_id, title, keywords, angle, source, status) VALUES(?,?,?,?,?,?)');
  const topicRows = [
    [issueId, '7월 전기요금 인상, 우리집 얼마나 더 낼까', '전기요금 인상, 누진세, 절약', '실제 청구서 기준 시뮬레이션으로 계산', 'llm', 'pool'],
    [issueId, '요즘 편의점에서 품절대란 난 그 상품 정리', '편의점 신상, 품절대란, 리뷰', '직접 구해서 먹어본 후기 톤', 'manual', 'pool'],
    [lifeId, '여름 장마철 제습기 없이 습기 잡는 법 7가지', '장마 습기 제거, 제습, 곰팡이 예방', '제습기 구매 전 무료 방법 먼저', 'llm', 'pool'],
    [lifeId, '냉장고 전기세 아끼는 설정 하나로 월 5천원 절약', '냉장고 전기세, 절전, 여름 전기요금', '설정 스크린샷 중심 실용 가이드', 'llm', 'pool'],
    [moneyId, '2026 하반기 정부지원금 놓치면 손해인 것들', '정부지원금, 신청 방법, 하반기 정책', '신청 마감일 순 정리', 'manual', 'pool'],
    [moneyId, '파킹통장 금리 비교, 지금 갈아탈 곳은?', '파킹통장 금리, 비교, CMA', '금리 변동 이력까지 표로', 'llm', 'pool'],
  ];
  for (const t of topicRows) topic.run(...t);

  // 발행 이력 데모: 지난 며칠간 발행된 콘텐츠 2건
  const content = db.prepare(
    `INSERT INTO contents(topic_id, category_id, title, summary, body, tags, status, policy_report, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,datetime('now','localtime',?),datetime('now','localtime',?))`,
  );
  const variant = db.prepare(
    `INSERT INTO variants(content_id, media_account_id, platform, title, body, extra, status, published_at, published_url, simulated, created_at)
     VALUES(?,?,?,?,?,?,?,datetime('now','localtime',?),?,1,datetime('now','localtime',?))`,
  );
  const demoBody = '## 데모 발행 이력\n\n대시보드 확인용으로 시드된 과거 발행 콘텐츠입니다.';
  const c1 = Number(content.run(null, lifeId, '에어컨 전기세 반값 만드는 여름철 설정법',
    '에어컨 제습·냉방 모드별 전기요금 차이를 실측 기준으로 정리한 데모 콘텐츠.', demoBody,
    '에어컨, 전기세, 절약', 'published', '{"level":"ok","hits":[]}', '-3 days', '-3 days').lastInsertRowid);
  const c2 = Number(content.run(null, moneyId, '카드 포인트 현금화, 3분 만에 끝내는 법',
    '잠자는 카드 포인트를 계좌로 옮기는 절차를 정리한 데모 콘텐츠.', demoBody,
    '카드포인트, 현금화, 재테크', 'published', '{"level":"ok","hits":[]}', '-1 days', '-1 days').lastInsertRowid);
  const lifeAccs = accIds.filter((_, i) => accounts[i][2] === lifeId).slice(0, 3);
  const moneyAccs = accIds.filter((_, i) => accounts[i][2] === moneyId).slice(0, 3);
  lifeAccs.forEach((id, i) => {
    const p = byPlatform[id];
    variant.run(c1, id, p, '에어컨 전기세 반값 설정법', demoBody, '{"demo":true}', 'published', '-3 days', `https://demo.mediadot.local/${p}/${id}/seed`, '-3 days');
  });
  moneyAccs.forEach((id, i) => {
    const p = byPlatform[id];
    variant.run(c2, id, p, '카드 포인트 현금화 3분 정리', demoBody, '{"demo":true}', 'published', '-1 days', `https://demo.mediadot.local/${p}/${id}/seed`, '-1 days');
  });

  // 최근 60일 수익 데모 — 완만한 우상향 + 요일 변동 (이전 30일 대비 증감률 표시용)
  const rev = db.prepare('INSERT INTO revenues(ad_account_id, media_account_id, date, amount, currency, memo) VALUES(?,?,?,?,?,?)');
  const adBase = [
    [adsense, 15000, 1.9], [adpost, 5200, 1.4], [adfit, 2300, 1.2],
    [coupang, 7400, 2.4], [dable, 1500, 1.1],
  ];
  for (let d = 59; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const iso = date.toISOString().slice(0, 10);
    const growth = 1 + (59 - d) * 0.011; // 완만한 성장
    const weekend = [0, 6].includes(date.getDay()) ? 0.85 : 1;
    for (const [adId, base, vol] of adBase) {
      const amount = Math.round(base * growth * weekend * (1 + (rand() - 0.5) * vol) / 10) * 10;
      if (amount > 0) rev.run(adId, null, iso, amount, 'KRW', '데모 수익 데이터');
    }
  }

  setSetting('publish_mode', 'confirm');
  setSetting('simulate_publish', '1');
  log('system', '데모 데이터 시드 완료 — 계정·매칭·주제·수익 데이터는 모두 데모이며 자유롭게 수정/삭제할 수 있습니다.');
  return true;
}

module.exports = { run };

if (require.main === module) {
  const created = run();
  console.log(created ? '데모 데이터 시드 완료' : '이미 데이터가 존재하여 건너뜀');
}
