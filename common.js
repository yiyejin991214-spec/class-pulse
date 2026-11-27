// ===== common.js : 두 화면(선생님·학생)이 함께 쓰는 연결 · 시계 · 실시간 =====
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ANIMALS = [
  { key: 'zebra', emoji: '🦓' }, { key: 'panda', emoji: '🐼' }, { key: 'lion', emoji: '🦁' },
  { key: 'tiger', emoji: '🐯' }, { key: 'koala', emoji: '🐨' }, { key: 'rabbit', emoji: '🐰' },
  { key: 'bear', emoji: '🐻' }, { key: 'fox', emoji: '🦊' }
];
const animalEmoji = k => (ANIMALS.find(a => a.key === k) || { emoji: '🙂' }).emoji;

const SIGNALS = {
  green:  { emoji: '🟢', label: '알겠어요',      sub: '잘 이해했어요' },
  yellow: { emoji: '🟡', label: '조금 헷갈려요', sub: '한 번만 더 설명해 주세요' },
  red:    { emoji: '🔴', label: '모르겠어요',    sub: '도움이 필요해요' }
};

const ERR = {
  no_room: '없는 방이에요. 방 번호를 확인해 주세요.',
  ended: '이미 끝난 수업이에요.',
  bad_name: '이름은 1~10자로 써 주세요.',
  bad_animal: '동물 친구를 골라 주세요.',
  duplicate_name: '같은 이름이 이미 있어요. 다른 이름을 써 주세요.',
  full: '방이 가득 찼어요.',
  forbidden: '권한이 없어요.',
  not_playing: '수업이 진행 중일 때만 할 수 있어요.',
  too_fast: '조금만 천천히! 잠깐 뒤에 다시 눌러 주세요.',
  limit: '질문은 3개까지 보낼 수 있어요.',
  bad_body: '질문은 1~100자로 써 주세요.',
  own_question: '내 질문에는 누를 수 없어요.',
  no_question: '사라진 질문이에요.',
  bad_state: '지금은 할 수 없는 동작이에요.',
  busy: '지금 방이 많아요. 잠시 뒤에 다시 해 주세요.',
  bad_duration: '수업 시간은 1~120분이에요.'
};
const errText = e => ERR[e] || ('문제가 생겼어요 (' + e + ')');

// DB 함수 부르기: 네트워크 오류는 throw, 규칙 위반은 { ok:false, error } 로 받아요
async function rpc(fn, args) {
  const { data, error } = await db.rpc(fn, args || {});
  if (error) throw error;
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ----- 서버 시계: 내 시계가 달라도 같은 남은 시간 -----
// 차이 = S - (t0 + t1) / 2   (S: 서버가 적어 준 시각)
let clockOffset = 0;
async function syncClock(samples) {
  let best = null;
  for (let i = 0; i < (samples || 3); i++) {
    const t0 = Date.now();
    const s = Number(await rpc('server_now_ms'));
    const t1 = Date.now();
    const rtt = t1 - t0;
    const off = s - (t0 + t1) / 2;
    if (!best || rtt < best.rtt) best = { rtt, off };
  }
  clockOffset = best.off;
}
const serverNow = () => Date.now() + clockOffset;
function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// ----- 알림창 -----
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ----- 실시간 구독 + 끊겼을 때 자동 대비책 -----
// 0초: 구독 시도 -> 연결되면 알림으로 즉시 -> 6초 안에 안 되면 2초마다 가져오기
// 언제나 10초마다 전체 다시 맞춤
function liveSync(opts) {
  const badge = document.createElement('div');
  badge.className = 'sync';
  badge.innerHTML = '<i></i><span></span>';
  document.body.appendChild(badge);

  let connected = false, busy = false, lastRun = 0, lostSince = Date.now(), deb = null;
  const paint = () => {
    badge.classList.toggle('on', connected);
    badge.lastChild.textContent = connected ? '실시간 연결됨' : '자동 새로고침 중';
  };
  const run = async () => {
    if (busy) return;
    busy = true; lastRun = Date.now();
    try { await opts.refresh(); } catch (e) { console.warn('refresh 실패', e); }
    busy = false;
  };
  const kick = () => { clearTimeout(deb); deb = setTimeout(run, 250); };

  const ch = db.channel('sync-' + Math.random().toString(36).slice(2));
  (opts.tables || []).forEach(t =>
    ch.on('postgres_changes', { event: '*', schema: 'public', table: t.table, filter: t.filter }, kick));
  ch.subscribe(status => {
    const was = connected;
    connected = status === 'SUBSCRIBED';
    if (!connected && was) lostSince = Date.now();
    paint();
    if (connected) kick();
  });

  setInterval(() => {
    const now = Date.now();
    const need = connected ? now - lastRun > 10000 : now - lostSince > 6000;
    if (need) run();
  }, 2000);

  paint();
  run();
  return { refreshNow: run };
}
