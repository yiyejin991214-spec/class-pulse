// Vercel 서버 함수: /api/summarize  (선택 기능 — AI로 질문 묶어 보기)
// 1) 선생님 비밀 코드를 Supabase에 확인  2) 질문 글만 읽어 오기(이름 제외)  3) Gemini에게 묶어 달라고 요청
// 키는 코드에 쓰지 않고 Vercel 환경변수에만 둡니다:
//   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY(publishable), GEMINI_MODEL(선택)

async function sb(fn, args) {
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_KEY
    },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error('supabase ' + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST만 가능해요' });
  const { GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY } = process.env;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY)
    return res.status(500).json({ ok: false, error: '서버 환경변수가 설정되지 않았어요' });

  try {
    const { room, teacher_code } = req.body || {};
    if (!room || !teacher_code) return res.status(400).json({ ok: false, error: 'room, teacher_code가 필요해요' });

    // 선생님만 쓸 수 있어요 (내 Gemini 한도를 아무나 쓰지 못하게)
    const isTeacher = await sb('verify_teacher', { p_room: room, p_teacher_code: teacher_code });
    if (isTeacher !== true) return res.status(403).json({ ok: false, error: '권한이 없어요' });

    const list = await sb('list_questions', { p_room: room, p_teacher_code: teacher_code });
    const texts = list.map(q => q.body).slice(0, 60);          // 이름은 보내지 않고 질문 글만
    if (texts.length === 0) return res.json({ ok: true, themes: [], tip: '아직 질문이 없어요.' });

    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const prompt =
      '아래는 초등학교 수업 중 학생들이 익명으로 남긴 질문 목록이야.\n' +
      '비슷한 질문끼리 2~4개 주제로 묶고, 각 주제에 짧은 제목과 개수, 포함된 질문(원문 그대로)을 넣어줘.\n' +
      '마지막으로 선생님이 바로 쓸 수 있는 수업 팁을 1~2문장으로 적어줘.\n' +
      '반드시 아래 JSON 형식만 출력해:\n' +
      '{"themes":[{"title":"","count":0,"questions":[""]}],"tip":""}\n\n질문 목록:\n' +
      texts.map((t, i) => (i + 1) + '. ' + t).join('\n');

    const g = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
        })
      }
    );
    if (!g.ok) return res.status(502).json({ ok: false, error: 'Gemini 응답 오류 ' + g.status + ' (모델 이름과 키를 확인해 주세요)' });

    const data = await g.json();
    const raw = data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text || '{}';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch (e) { return res.status(502).json({ ok: false, error: 'AI 답을 읽지 못했어요. 다시 눌러 주세요' }); }

    return res.json({ ok: true, themes: parsed.themes || [], tip: parsed.tip || '' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: '서버 오류: ' + e.message });
  }
};
