// 플랫폼 카탈로그 — 미디어(발행) 플랫폼과 광고(수익) 플랫폼 정의.
// rewriteProfile은 LLM 리라이팅 프롬프트에 주입되는 플랫폼별 기본 전략이다.
// (지침 탭에서 수정하면 guidelines 테이블의 값이 우선 적용된다)
// publish.mode: 'api'     = 공식 API로 자동 발행 (자격증명 필요)
//               'browser' = 공식 API가 없어 브라우저 자동화(Playwright)로 발행 — 실패 시 수동 폴백
//               'manual'  = 완성 원고 복사·붙여넣기 패키지 생성(반자동)

const MEDIA_PLATFORMS = {
  blogger: {
    name: '블로그스팟(Blogger)',
    kind: 'blog',
    publish: {
      mode: 'api',
      api: 'Google Blogger API v3',
      // access_token은 1시간이면 만료되므로 refresh_token 방식을 권장한다.
      // refresh_token(+client_id/secret)이 있으면 발행 직전에 액세스 토큰을 자동 갱신한다.
      credentialFields: [
        { key: 'blog_id', label: 'Blog ID', required: true },
        { key: 'client_id', label: 'Google OAuth Client ID', required: false, hint: 'refresh token 방식(권장)' },
        { key: 'client_secret', label: 'Google OAuth Client Secret', required: false, secret: true },
        { key: 'refresh_token', label: 'Refresh Token (권장 — 만료 없음)', required: false, secret: true },
        { key: 'access_token', label: 'Access Token (임시 대체 — 1시간 만료)', required: false, secret: true },
      ],
      // refresh_token 세트 또는 단기 access_token 중 하나만 있으면 발행 가능.
      validate(c) {
        if (!c.blog_id) return { ok: false, missing: ['Blog ID'] };
        const hasRefresh = c.refresh_token && c.client_id && c.client_secret;
        if (hasRefresh || c.access_token) return { ok: true };
        return { ok: false, missing: ['Refresh Token(+Client ID·Secret) 또는 Access Token'] };
      },
    },
    adFit: ['adsense', 'coupang_partners', 'taboola', 'dable'],
    rewriteProfile: {
      format: 'html',
      tone: '경험과 전문성이 느껴지는 정보성 문체. 검색 유입(구글 SEO)이 최우선 — 독자의 검색 의도에 정면으로 답한다.',
      structure: '① 도입: 독자가 겪는 문제를 2~3문장으로 짚어 공감대 형성(검색해서 들어온 이유에 바로 답할 것을 예고) ② 본문: H2 소제목 4~6개, 소제목마다 해결책을 단계별로 제시, 표·리스트 적극 활용 ③ FAQ 2~3개(H3) ④ 결론: 핵심 요약 + 오늘 바로 실행할 팁 1가지. 결론 직전에 "함께 보면 좋은 정보" 섹션(광고·수익 링크 자리)을 배치.',
      length: '2,000자 이상 장문',
      notes: '핵심 키워드는 제목 1회·첫 문단 1회·본문 5~7회만 자연스럽게(도배 금지, 유의어 활용). 광고 삽입 위치 <!--AD--> 주석을 본문 중간 2곳(정보 단락이 끝나는 지점)에 표시. 근거 없는 수치·단정 금지.',
    },
  },
  naver_blog: {
    name: '네이버 블로그',
    kind: 'blog',
    publish: {
      mode: 'browser',
      api: '브라우저 자동화 (스마트에디터 ONE)',
      manualReason: '네이버 블로그는 공식 발행 API가 없어(구 XML-RPC 종료) 브라우저 자동화로 발행합니다. 로그인 정보가 없거나 캡차·2단계 인증으로 자동화가 막히면 복사·붙여넣기 수동 발행으로 전환됩니다.',
      credentialFields: [
        { key: 'naver_id', label: '네이버 아이디', required: true },
        { key: 'naver_pw', label: '네이버 비밀번호', required: true, secret: true },
        { key: 'blog_url', label: '블로그 주소', required: false },
      ],
    },
    adFit: ['adpost'],
    rewriteProfile: {
      format: 'text',
      tone: '친근한 존댓말 1인칭, 직접 겪어본 사람의 경험담 톤. 네이버 검색(C-Rank/DIA)은 체류시간과 진정성을 본다 — 광고 같은 문장은 즉시 이탈로 이어진다.',
      structure: '① 도입: "저도 이것 때문에 한참 고생했는데요" 식의 공감·경험 서두로 문제 제기 ② 본문: [소제목] 표기로 소제목 4~6개, 소제목당 한 가지 해결책, 2~3문장마다 문단을 나눠 모바일 가독성 확보 ③ 마무리: 개인적인 소감 + 독자에게 묻는 질문 1개(댓글 유도). 마무리 직전에 "함께 보면 좋은 정보" 한 단락(수익 링크 자리). [이미지: 장면 묘사]를 본문 중간 2~3곳에 배치.',
      length: '1,500자 내외',
      notes: '핵심 키워드는 제목 1회 + 본문 5~7회만 자연스럽게. 타 플랫폼 원고와 서두·제목·문장 구조를 완전히 다르게(저품질 방지). 이모지는 소제목당 1개 이내로 절제. 글에서 가장 핵심이 되는 한 문장이나 인상적인 한 마디는 그 줄 맨 앞에 "> "(꺾쇠+공백)를 붙여 인용구로 강조하세요 — 네이버 블로그 인용구 박스로 자동 변환됩니다. 인용구는 글 전체에서 1~2번만, 앞뒤 빈 줄로 감싼 별도 문단으로 넣으세요.',
    },
  },
  tistory: {
    name: '티스토리',
    kind: 'blog',
    publish: {
      mode: 'browser',
      api: '브라우저 자동화 (티스토리 에디터)',
      manualReason: '티스토리 Open API가 2024년 종료되어 브라우저 자동화로 발행합니다. 로그인 정보가 없거나 2단계 인증으로 자동화가 막히면 복사·붙여넣기 수동 발행으로 전환됩니다.',
      credentialFields: [
        { key: 'kakao_email', label: '카카오 계정(이메일)', required: true },
        { key: 'kakao_pw', label: '카카오 비밀번호', required: true, secret: true },
        { key: 'blog_name', label: '블로그 이름 (xxx.tistory.com의 xxx)', required: true },
      ],
    },
    adFit: ['adsense', 'adfit', 'coupang_partners', 'dable'],
    rewriteProfile: {
      format: 'html',
      tone: '군더더기 없는 깔끔한 정보성 문체. 다음·구글 동시 검색 유입이 목표 — 결론부터 말하고 근거를 뒤에 붙인다.',
      structure: '① 서두: 3줄 핵심 요약 박스(이 글에서 얻어갈 것) ② 본문: H2/H3 소제목, 비교·정리는 표로, 절차는 번호 리스트로 ③ FAQ 2개 ④ 결론: 요약 + "함께 보면 좋은 정보" 섹션(광고·수익 링크 자리). [이미지: 장면 묘사] 2~3곳, 광고 위치 <!--AD--> 본문 중간 2곳.',
      length: '1,800자 이상',
      notes: '제목 앞쪽에 핵심 키워드 전방 배치(다음 검색 대응). 키워드 본문 5~7회 자연 배치. 블로그스팟·네이버 원고와 서두·구조를 확실히 다르게.',
    },
  },
  wordpress: {
    name: '워드프레스',
    kind: 'blog',
    publish: {
      mode: 'api',
      api: 'WordPress REST API',
      // 자체 호스팅(wp-json + Application Password) 과 가입형(WordPress.com public-api + 액세스 토큰) 둘 다 지원.
      // 가입형 무료·하위 플랜은 기본 wp-json 경로를 막으므로 public-api.wordpress.com 을 사용해야 한다.
      credentialFields: [
        { key: 'site_url', label: '사이트 URL', required: true, hint: '예: https://내블로그.com 또는 infodury.wordpress.com' },
        { key: 'username', label: '사용자명 (자체 호스팅)', required: false },
        { key: 'app_password', label: 'Application Password (자체 호스팅)', required: false, secret: true },
        { key: 'wpcom_token', label: 'WordPress.com 액세스 토큰 (가입형 .wordpress.com)', required: false, secret: true, hint: 'developer.wordpress.com/apps 에서 발급 — 만료 없음' },
      ],
      validate(c) {
        if (!c.site_url) return { ok: false, missing: ['사이트 URL'] };
        // .wordpress.com 가입형이면 액세스 토큰 필요
        if (isWpcomHost(c.site_url) || c.wpcom_token) {
          return c.wpcom_token ? { ok: true } : { ok: false, missing: ['WordPress.com 액세스 토큰'] };
        }
        const miss = [];
        if (!c.username) miss.push('사용자명');
        if (!c.app_password) miss.push('Application Password');
        return miss.length ? { ok: false, missing: miss } : { ok: true };
      },
    },
    adFit: ['adsense', 'taboola', 'dable', 'coupang_partners'],
    rewriteProfile: {
      format: 'html',
      tone: '전문 매체 기사 스타일. 자체 도메인 브랜딩을 살린 신뢰감 있는 문체 — 데이터와 인용으로 말한다.',
      structure: '① 리드: 핵심 결론 요약 2문장 ② 본문: H2/H3, 인용구·통계 활용(출처 표기), 단락은 3~4문장으로 짧게 끊어 광고 슬롯 확보 ③ 결론: 전망·시사점 + "함께 보면 좋은 정보" 섹션. [이미지: 장면 묘사] 2곳, [내부링크: 관련 주제] 제안 1~2곳.',
      length: '2,000자 이상',
      notes: '애드센스+타불라 병행 게재 전제. 키워드 5~7회 자연 배치, 과장·단정 표현 금지.',
    },
  },
  instagram: {
    name: '인스타그램',
    kind: 'sns',
    publish: {
      mode: 'api',
      api: 'Instagram Graph API (카드뉴스 캐러셀 자동 업로드)',
      credentialFields: [
        { key: 'ig_user_id', label: 'IG 비즈니스 계정 ID', required: true },
        { key: 'access_token', label: 'Meta Access Token', required: true, secret: true },
        { key: 'default_image_url', label: '대체 이미지 URL (공개 접근 가능한 https 이미지)', required: false, hint: '카드뉴스 자동 업로드가 안 될 때 이 이미지로 단일 게시. 설정 → 이미지 엔진의 전역 대체 이미지로도 지정 가능' },
      ],
    },
    adFit: ['coupang_partners'],
    limits: { caption: 2200 },
    rewriteProfile: {
      format: 'cards',
      tone: '3초 안에 시선을 잡는 카드뉴스 문구. 한 장에 한 메시지, 짧고 강하게.',
      structure: '① 표지 1장: 호기심 갭을 만드는 후킹 문구(15자 내외, 숫자·반전 활용 — 예: "이거 모르면 전기요금 2배") ② 내용 5~7장: 장당 핵심 1개·2문장 이내, 이모지 1~2개로 시각 피로 완화 ③ 마지막 장: 저장·팔로우 유도 CTA. 캡션: 첫 줄에 표지와 다른 각도의 훅 → 줄바꿈 과감하게 → 핵심 요약 → 프로필 링크 유도 문구("자세한 내용은 프로필 링크에서").',
      length: '카드 6~8장, 캡션 300~500자',
      notes: '해시태그는 15~20개 나열이 아니라 맥락에 맞는 3~5개만(대형 2·중형 2·니치 1). 캡션 첫 줄이 승부처 — 잘리기 전 문장으로 완결시킬 것.',
    },
  },
  facebook: {
    name: '페이스북',
    kind: 'sns',
    publish: {
      mode: 'api',
      api: 'Meta Graph API (페이지 게시)',
      credentialFields: [
        { key: 'page_id', label: '페이지 ID', required: true },
        { key: 'page_access_token', label: 'Page Access Token', required: true, secret: true },
      ],
    },
    adFit: ['coupang_partners'],
    rewriteProfile: {
      format: 'text',
      tone: '친구에게 이야기하듯 풀어내는 문체. 공유 버튼을 누르게 만드는 정서적 포인트(놀라움·유용함·공감) 1개를 심는다.',
      structure: '① 첫 두 줄: "더보기" 접힘 전에 승부 — 호기심 훅 + 핵심 약속 ② 본문: 짧은 문단, 이모지 절제(문단당 1개 이내) ③ 마무리: 자세한 내용은 링크로 유도하는 자연스러운 문구.',
      length: '300~500자',
      notes: '블로그 트래픽 펌프 역할 — 링크 클릭이 목적. 낚시성 과장 대신 구체적 이득을 약속할 것.',
    },
  },
  threads: {
    name: '스레드(Threads)',
    kind: 'sns',
    publish: {
      mode: 'api',
      api: 'Threads API',
      credentialFields: [
        { key: 'threads_user_id', label: 'Threads 사용자 ID', required: true },
        { key: 'access_token', label: 'Threads Access Token', required: true, secret: true },
      ],
    },
    adFit: ['coupang_partners'],
    limits: { perPost: 480 },
    rewriteProfile: {
      format: 'thread',
      tone: '대화체, 위트 있게 — 광고 냄새가 나는 순간 도달이 급락하는 플랫폼. 친구가 꿀팁 공유하는 톤.',
      structure: '① 첫 포스트: 첫 줄 훅(질문 또는 의외의 사실) + 핵심 요약, 480자 이내 ② 답글 2~3개: 포인트 하나씩 부연, 줄바꿈 과감하게 ③ 마지막 답글: 커뮤니티 반응을 유도하는 질문 + 링크(있다면 여기에만).',
      length: '포스트 3~4개 체인 (각 480자 이내)',
      notes: '정보 가치 먼저, 판매 문구는 금지. 이모지는 포스트당 1~2개.',
    },
  },
  x_twitter: {
    name: 'X(트위터)',
    kind: 'sns',
    publish: {
      mode: 'api',
      api: 'X API v2 (POST /2/tweets)',
      credentialFields: [
        { key: 'access_token', label: 'OAuth2 User Access Token', required: true, secret: true },
      ],
    },
    adFit: ['coupang_partners'],
    limits: { perPost: 140 },
    rewriteProfile: {
      format: 'thread',
      tone: '단문 임팩트. 숫자·반전·단정적 리듬 활용 — 스크롤을 멈추게 하는 첫 문장이 전부다.',
      structure: '① 리드 트윗: 훅 한 방(숫자나 반전, 한글 140자 이내 — X는 한글을 2글자로 계산) ② 본문 트윗 3~5개: 트윗당 포인트 1개, 짧게 끊어치기 ③ 마지막 트윗: CTA + 링크.',
      length: '트윗 4~6개 (각 한글 140자 이내)',
      notes: 'X 수익화(광고 수익 공유)는 노출량이 조건 — 리드 트윗 후킹에 전력. 해시태그는 1~2개만(그 이상은 도달 저하).',
    },
  },
  tiktok: {
    name: '틱톡',
    kind: 'video',
    publish: {
      mode: 'manual',
      api: null,
      manualReason: '영상 제작이 필요하므로 촬영·편집용 대본과 자막 텍스트를 생성(반자동). Content Posting API는 영상 파일 업로드 전제.',
      credentialFields: [{ key: 'handle', label: '@핸들', required: false }],
    },
    adFit: ['creator_rewards'],
    rewriteProfile: {
      format: 'script',
      tone: '나레이션용 구어체(~죠, ~해보세요, ~거든요). 빠른 템포, 문장은 짧고 강렬하게 쪼갠다 — 한 문장 = 한 호흡.',
      structure: '① 훅(0~3초): 시청자를 붙잡는 한 문장("이거 아직도 모르세요?") ② 본문: 포인트 3개, 포인트마다 [화면: 연출 지시]와 자막 문구 ③ 중반(15~20초 지점): 가벼운 CTA 한 줄 ④ 엔딩: 팔로우 유도. 이탈 방지를 위해 답을 끝까지 아껴둘 것.',
      length: '30~45초 분량 대본 (+1분 이상 롱버전 대본 함께)',
      notes: '크리에이터 리워드는 1분 이상 영상만 정산 — 롱버전이 수익용. 고정 댓글용 CTA 문구를 별도 생성.',
    },
  },
  youtube: {
    name: '유튜브(쇼츠)',
    kind: 'video',
    publish: {
      mode: 'manual',
      api: null,
      manualReason: '영상 제작이 필요하므로 쇼츠 대본·제목·설명·태그 패키지를 생성(반자동). Data API 업로드는 영상 파일 전제.',
      credentialFields: [{ key: 'channel_url', label: '채널 URL', required: false }],
    },
    adFit: ['youtube_partner'],
    rewriteProfile: {
      format: 'script',
      tone: '신뢰감 있는 정보 압축 나레이션체 — 구어체(~인데요, ~해보세요)로 말하듯, 문장은 영상 호흡에 맞춰 짧게.',
      structure: '① 훅(0~3초): 질문으로 시작해 답을 유예("전기요금이 반으로 준다면?") ② 본문(45초): 답을 단계별로 공개, 장면마다 [화면: 연출] 지시 ③ 중반: 구독·저장 CTA 한 줄 ④ 엔딩: 다음 영상 예고형 마무리(재방문 유도). 별도로 영상 제목 3안 + 설명문 + 태그 10개.',
      length: '45~60초 분량',
      notes: '시청 유지율이 수익의 전부 — 답을 앞에서 다 말하지 말 것. 고정 댓글용 CTA 문구를 별도 생성.',
    },
  },
};

const AD_PLATFORMS = {
  adsense: {
    name: '구글 애드센스',
    attach: ['blogger', 'tistory', 'wordpress'],
    payout: 'CPC/CPM',
    note: '블로그 수익의 중심. 승인까지 양질의 글 15~20개 필요. 정책 위반(의료·금융 과장, 성인 등) 시 게재 제한 → 정책 검사 필수.',
    sync: {
      api: 'AdSense Management API v2',
      required: ['publisher_id', 'client_id', 'client_secret', 'refresh_token'],
      guide: 'Google Cloud Console에서 OAuth 클라이언트 생성 → adsense.readonly 스코프로 refresh token 발급.',
    },
    credentialFields: [
      { key: 'publisher_id', label: '게시자 ID (pub-...)', required: false },
      { key: 'client_id', label: 'Google OAuth Client ID', required: false },
      { key: 'client_secret', label: 'Google OAuth Client Secret', required: false, secret: true },
      { key: 'refresh_token', label: 'Refresh Token', required: false, secret: true },
    ],
  },
  adpost: {
    name: '네이버 애드포스트',
    attach: ['naver_blog'],
    payout: 'CPC',
    note: '블로그 운영 90일·포스트 50개 이상 등 실적 필요. 저품질 판정 시 노출 급감 → 리라이팅 차별화가 핵심.',
    credentialFields: [{ key: 'account_email', label: '애드포스트 계정', required: false }],
  },
  adfit: {
    name: '카카오 애드핏',
    attach: ['tistory'],
    payout: 'CPC/CPM',
    note: '티스토리에서 애드센스와 병행 가능. 승인 문턱이 낮아 초기 수익화에 유리.',
    credentialFields: [{ key: 'ad_unit_id', label: '광고단위 ID', required: false }],
  },
  coupang_partners: {
    name: '쿠팡 파트너스',
    attach: ['blogger', 'naver_blog', 'tistory', 'wordpress', 'instagram', 'facebook', 'threads', 'x_twitter'],
    payout: '판매 수수료 3%',
    note: '가입 즉시 링크 생성 가능. 상품 연관 콘텐츠(생활정보·리뷰)와 궁합이 좋음. 대가성 문구 표기 의무.',
    sync: {
      api: '쿠팡 파트너스 Open API (커미션 리포트)',
      required: ['access_key', 'secret_key'],
      guide: '파트너스 → 추가기능 → Open API에서 Access/Secret Key 발급.',
    },
    credentialFields: [
      { key: 'access_key', label: 'Access Key', required: false, secret: true },
      { key: 'secret_key', label: 'Secret Key', required: false, secret: true },
    ],
  },
  taboola: {
    name: '타불라(Taboola)',
    attach: ['blogger', 'wordpress'],
    payout: 'CPC (네이티브 광고)',
    note: '월 50만 PV 내외 트래픽 필요. 애드센스와 병행해 블로그 하단 추가 수익.',
    sync: {
      api: 'Taboola Backstage API (revenue-summary)',
      required: ['client_id', 'client_secret', 'account_id'],
      guide: '타불라 담당자에게 Backstage API 자격증명 요청. USD 정산 → 설정의 환율로 원화 환산 저장.',
    },
    credentialFields: [
      { key: 'publisher_name', label: 'Publisher 명', required: false },
      { key: 'account_id', label: 'Account ID', required: false },
      { key: 'client_id', label: 'API Client ID', required: false },
      { key: 'client_secret', label: 'API Client Secret', required: false, secret: true },
    ],
  },
  dable: {
    name: '데이블(Dable)',
    attach: ['tistory', 'wordpress', 'blogger'],
    payout: 'CPC (네이티브 광고)',
    note: '국내 네이티브 광고. 타불라보다 진입 문턱이 낮아 국내 트래픽 블로그에 유리.',
    credentialFields: [{ key: 'service_id', label: '서비스 ID', required: false }],
  },
  creator_rewards: {
    name: '틱톡 크리에이터 리워드',
    attach: ['tiktok'],
    payout: 'RPM (조회수 기반)',
    note: '팔로워 1만·최근 30일 조회 10만 필요. 1분 이상 영상만 정산 대상.',
    credentialFields: [],
  },
  youtube_partner: {
    name: '유튜브 파트너 프로그램',
    attach: ['youtube'],
    payout: '광고 수익 배분 (쇼츠 RPM)',
    note: '구독 1,000명 + 쇼츠 조회 1,000만(90일) 또는 시청 4,000시간 필요.',
    sync: {
      api: 'YouTube Analytics API (estimatedRevenue)',
      required: ['client_id', 'client_secret', 'refresh_token'],
      guide: 'Google Cloud Console에서 OAuth 클라이언트 생성 → yt-analytics-monetary.readonly 스코프로 refresh token 발급.',
    },
    credentialFields: [
      { key: 'client_id', label: 'Google OAuth Client ID', required: false },
      { key: 'client_secret', label: 'Google OAuth Client Secret', required: false, secret: true },
      { key: 'refresh_token', label: 'Refresh Token', required: false, secret: true },
    ],
  },
  tenping: {
    name: '텐핑(CPA)',
    attach: ['blogger', 'naver_blog', 'tistory', 'wordpress', 'facebook', 'threads', 'x_twitter'],
    payout: 'CPA/CPS (행동당 과금)',
    note: '클릭 대비 단가가 높은 캠페인형 수익. 콘텐츠와 자연스럽게 어울리는 캠페인만 선별 삽입.',
    credentialFields: [{ key: 'member_id', label: '회원 ID', required: false }],
  },
};

/** site_url이 WordPress.com 가입형 호스트(*.wordpress.com)인지 판별한다. */
function isWpcomHost(siteUrl) {
  if (!siteUrl) return false;
  try {
    const host = new URL(/^https?:\/\//.test(siteUrl) ? siteUrl : `https://${siteUrl}`).hostname;
    return /(^|\.)wordpress\.com$/i.test(host);
  } catch {
    return /(^|\/|\.)wordpress\.com/i.test(String(siteUrl));
  }
}

/**
 * 플랫폼별 자격증명 유효성 검사 — 발행 가능 여부 게이트.
 * def.publish.validate가 있으면 그것을 쓰고, 없으면 required 필드 전부 채워졌는지 확인한다.
 * @returns {{ok:boolean, missing:string[]}}
 */
function validateCreds(platformKey, creds = {}) {
  const def = MEDIA_PLATFORMS[platformKey];
  if (!def || !['api', 'browser'].includes(def.publish.mode)) return { ok: false, missing: [] };
  if (typeof def.publish.validate === 'function') return def.publish.validate(creds);
  const missing = def.publish.credentialFields
    .filter((f) => f.required && !(creds[f.key] && String(creds[f.key]).trim() !== ''))
    .map((f) => f.label);
  return { ok: missing.length === 0, missing };
}

module.exports = { MEDIA_PLATFORMS, AD_PLATFORMS, validateCreds, isWpcomHost };
