// 플랫폼 카탈로그 — 미디어(발행) 플랫폼과 광고(수익) 플랫폼 정의.
// rewriteProfile은 LLM 리라이팅 프롬프트에 그대로 주입되는 플랫폼별 전략이다.
// publish.mode: 'api'  = 공식 API로 자동 발행 가능 (자격증명 필요)
//               'manual' = 공식 발행 API가 없거나 종료됨 → 복사·붙여넣기 패키지 생성(반자동)

const MEDIA_PLATFORMS = {
  blogger: {
    name: '블로그스팟(Blogger)',
    kind: 'blog',
    publish: {
      mode: 'api',
      api: 'Google Blogger API v3',
      credentialFields: [
        { key: 'blog_id', label: 'Blog ID', required: true },
        { key: 'access_token', label: 'Google OAuth Access Token', required: true, secret: true },
      ],
    },
    adFit: ['adsense', 'coupang_partners', 'taboola', 'dable'],
    rewriteProfile: {
      format: 'html',
      tone: '정보성·전문적. 검색 유입(구글 SEO)을 노린 명확한 헤딩 구조.',
      structure: 'H2/H3 헤딩 구조, 서론-본론(3~5섹션)-FAQ-결론. 목차 삽입 지점 표시.',
      length: '2000자 이상 장문',
      notes: '애드센스 승인·게재 기준을 의식해 근거 있는 정보 위주로. 광고 삽입 위치를 <!--AD--> 주석으로 본문 중간 2곳에 표시.',
    },
  },
  naver_blog: {
    name: '네이버 블로그',
    kind: 'blog',
    publish: {
      mode: 'manual',
      api: null,
      manualReason: '네이버 블로그는 공식 발행 API가 없음(구 XML-RPC API 종료). 복사용 완성 원고를 생성해 붙여넣기로 발행.',
      credentialFields: [{ key: 'blog_url', label: '블로그 주소', required: false }],
    },
    adFit: ['adpost'],
    rewriteProfile: {
      format: 'text',
      tone: '친근한 존댓말, 경험담 섞인 1인칭. 네이버 검색(C-Rank/DIA)은 진정성 있는 체류형 글을 선호.',
      structure: '후킹 서두 → 소제목 4~6개(이모지 활용 가능) → 개인적 마무리+공감 유도. [사진: 설명] 형태로 이미지 삽입 위치 표시.',
      length: '1500자 내외',
      notes: '검색 노출 저하(저품질) 방지: 타 플랫폼 원고와 문장 구조·서두·제목을 완전히 다르게. 키워드는 자연스럽게 5~7회만.',
    },
  },
  tistory: {
    name: '티스토리',
    kind: 'blog',
    publish: {
      mode: 'manual',
      api: null,
      manualReason: '티스토리 Open API가 2024년 종료됨. 완성 HTML 원고를 생성해 에디터에 붙여넣기로 발행.',
      credentialFields: [{ key: 'blog_url', label: '블로그 주소', required: false }],
    },
    adFit: ['adsense', 'adfit', 'coupang_partners', 'dable'],
    rewriteProfile: {
      format: 'html',
      tone: '깔끔한 정보성 문체. 다음·구글 동시 유입 target.',
      structure: 'H2/H3 헤딩, 표·리스트 적극 활용, 요약박스로 시작. 광고 위치 <!--AD--> 2곳.',
      length: '1800자 이상',
      notes: '티스토리 글은 다음 검색에 노출되므로 제목에 핵심 키워드 전방 배치. 블로그스팟 원고와 확실히 차별화.',
    },
  },
  wordpress: {
    name: '워드프레스',
    kind: 'blog',
    publish: {
      mode: 'api',
      api: 'WordPress REST API',
      credentialFields: [
        { key: 'site_url', label: '사이트 URL', required: true },
        { key: 'username', label: '사용자명', required: true },
        { key: 'app_password', label: 'Application Password', required: true, secret: true },
      ],
    },
    adFit: ['adsense', 'taboola', 'dable', 'coupang_partners'],
    rewriteProfile: {
      format: 'html',
      tone: '전문 매체 스타일. 자체 도메인 브랜딩을 살린 신뢰감 있는 문체.',
      structure: 'H2/H3, 인용구·통계 활용, 내부링크 제안 [내부링크: 주제] 표시.',
      length: '2000자 이상',
      notes: '애드센스+타불라 병행 게재를 전제로 단락을 짧게 끊어 광고 슬롯 확보.',
    },
  },
  instagram: {
    name: '인스타그램',
    kind: 'sns',
    publish: {
      mode: 'api',
      api: 'Instagram Graph API (이미지 필수)',
      credentialFields: [
        { key: 'ig_user_id', label: 'IG 비즈니스 계정 ID', required: true },
        { key: 'access_token', label: 'Meta Access Token', required: true, secret: true },
        { key: 'default_image_url', label: '기본 카드 이미지 URL(없으면 수동)', required: false },
      ],
    },
    adFit: ['coupang_partners'],
    rewriteProfile: {
      format: 'cards',
      tone: '짧고 강한 카드뉴스 문구. 한 장에 한 메시지.',
      structure: '표지 1장(후킹 문구) + 내용 5~7장(장당 2문장 이내) + 마지막 장(팔로우/저장 유도). 별도로 캡션과 해시태그 15~20개.',
      length: '카드 6~8장',
      notes: '캡션 첫 줄이 승부처. 프로필 링크(쿠팡 파트너스 등) 유도 문구 포함.',
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
      tone: '이야기하듯 풀어내는 문체. 공유를 부르는 정서적 포인트 1개.',
      structure: '첫 두 줄 후킹(더보기 접힘 고려) → 본문 요약 → 블로그 링크 유도 문구.',
      length: '300~500자',
      notes: '블로그 트래픽 펌프 역할. 링크 클릭 유도가 목적.',
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
    rewriteProfile: {
      format: 'thread',
      tone: '대화체, 위트 있게. 커뮤니티 반응(댓글)을 유도하는 질문형 마무리.',
      structure: '첫 포스트(500자 이내, 핵심 요약+후킹) + 이어지는 답글 2~3개로 부연.',
      length: '포스트 3~4개 체인',
      notes: '너무 광고 같으면 도달이 급락. 정보 가치 먼저, 링크는 마지막 답글에.',
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
    rewriteProfile: {
      format: 'thread',
      tone: '단문 임팩트. 숫자·반전 활용.',
      structure: '리드 트윗(280자 이내) + 스레드 3~5개. 마지막에 링크.',
      length: '트윗 4~6개',
      notes: 'X 수익화(광고 수익 공유) 조건인 노출량 확보를 위해 리드 트윗 후킹에 집중.',
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
      tone: '3초 안에 잡는 훅. 빠른 템포 구어체.',
      structure: '훅(0-3초) → 본문 3포인트(각 화면 자막 문구 포함) → CTA. 장면별 [화면: 연출] 지시.',
      length: '30~45초 분량 대본',
      notes: '크리에이터 리워드 프로그램은 1분 이상 영상 우대 → 롱버전 대본도 함께 생성.',
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
      tone: '정보 압축형. 신뢰감 있는 내레이션체.',
      structure: '쇼츠 대본(45~60초, 장면 지시 포함) + 영상 제목 3안 + 설명문 + 태그 10개.',
      length: '45~60초 분량',
      notes: '쇼츠 수익화(파트너 프로그램)를 위해 시청 유지율 높은 구조(질문→답 유예)로.',
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

module.exports = { MEDIA_PLATFORMS, AD_PLATFORMS };
