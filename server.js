'use strict';

const fs        = require('fs');
const path      = require('path');
const express   = require('express');
const sharp     = require('sharp');
const Anthropic = require('@anthropic-ai/sdk');

// ローカル起動時は同じフォルダの .env から APIキーを読み込む（Render では環境変数を使用）
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const MODEL = 'claude-opus-5-5';
const MAX_IMAGE_DIMENSION = 2000;
const JPEG_QUALITY = 88;
const API_TIMEOUT_MS = 600000;
const MAX_IMAGES = 10;
const MAX_PROBLEMS = 12; // A4一枚に収まる上限

const client = new Anthropic({ timeout: API_TIMEOUT_MS, maxRetries: 2 });

const app = express();
app.use(express.json({ limit: '60mb' }));

// APP_PASSWORD を設定すると、画面とAPIにパスワードがかかる（ユーザー名は何でもよい）
app.use((req, res, next) => {
  const password = process.env.APP_PASSWORD;
  if (!password) return next();
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    if (decoded.slice(decoded.indexOf(':') + 1) === password) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="jakuten-print", charset="UTF-8"');
  res.status(401).send('パスワードが必要です。');
});

const MISTAKE_TYPES = `■ミスの分類（A〜D：自分でへらせるミス／E・F：先生に聞く）
A 計算・スペルなどのミス … 解き方は合っているが、計算・符号・つづり・漢字の書き誤りなどで落とした（対策：見直し1回）
B 見まちがい・写しまちがい … 問題の数字や記号を見誤った、途中式から次の行へ写すときに誤った、答えを解答欄へ写し誤った（対策：指さし確認）
C とばし・見落とし … 空欄・解き忘れ、問題の一部（「すべて選べ」「単位をつけて」など）を落とした、途中の手順をとばした（対策：途中を書く）
D 問題の読みまちがい … 問われていることと違うことに答えた（「誤っているもの」を選ぶのに正しいものを選んだ、記号で答えるのに語句で答えた、など）（対策：2回読む）
E 習っていない・忘れた … 公式・用語・単語・知識そのものを知らない、覚えていない（対策：先生に聞く）
F 使い方が思いつかない … 知識はあるが、この問題でどう使えばよいか思いつかなかった。途中で手が止まっている（対策：先生に聞く）`;

const EXTRACT_SYSTEM = `あなたは中学生（中1〜中3）の5教科（国語・数学・英語・理科・社会）を教える、経験豊富な塾の先生です。
生徒の答案（教科書準拠ワーク・プリント・テストなど）の写真を読み取り、間違えた問題を抜き出して、ミスの種類を分類します。

■採点記号のルール（この塾のルール）
・正解：○（丸）がついている
・不正解：✗（バツ）または ✓（チェック）がついている、あるいは○がついていない（無印）
・つまり「○がついていない問題」はすべて不正解として扱う。空欄も不正解。
・問題番号が見えない、写真が切れていて判断できない問題は抜き出さない。

${MISTAKE_TYPES}

■分類のしかた
・生徒の答案（途中式・消しゴムの跡・書きかけ）と正しい答えを比べて、最も当てはまるものを1つ選ぶ。
・正しい答えは、写真に答えが印刷されていればそれを使い、なければあなたが解いて求める。
・判断材料が少ないとき：空欄で途中式もない → 知識問題なら E、応用問題なら F。書きかけで止まっている → F。
・mistake_reason には、先生が一目で分かるように根拠を短く書く（例：「7×8を54と計算」「x=−3を代入するところで符号を写し誤り」）。

■書き方
・question には、問題文を類題作成に使えるよう、必要な条件をすべて含めて書き起こす（リード文・表の値・図の説明も含める）。
・数式は $...$ で囲んだ LaTeX で書いてよい（例：$\\frac{3}{4}x - 2 = 7$）。下線部は <u>…</u> で囲む。
・図やグラフが解くのに必要な問題は needs_figure を true にし、question に図の内容（辺の長さ・角度・点の位置など）を文章で書く。
・unit は「1年 正負の数の加減」「2年 連立方程式の利用」「3年 現在完了」のように、学年と単元を書く。`;

const GENERATE_SYSTEM = `あなたは中学生（中1〜中3）の5教科を教える、経験豊富な塾の先生です。
生徒が間違えた問題とミスの分類をもとに、弱点補強プリント（類題）を作ります。プリントは A4 一枚に収め、解答・解説は別紙にします。

${MISTAKE_TYPES}

■類題の作り方
・元の問題と同じ単元・同じ解き方で、数値・語句・設定を変えた問題にする。答えが元の問題と同じにならないようにする。
・難易度は元の問題と同じくらい。中学校の学習指導要領の範囲を超えない。
・ミスの分類ごとに工夫する：
  A：同じ計算・つづりが必要な問題。reminder に「見直し1回：〜を確かめよう」のように、どこを確かめるかを具体的に書く。
  B：見誤りやすい数字・符号・記号を含む問題。reminder に「指さし確認：〜」と書く。
  C：途中式や手順が必要な問題、または答え方の条件がある問題。reminder に「途中を書く：〜」と書く。
  D：問われ方に注意が必要な問題（「誤っているもの」「記号で」「〜字以内で」など）。reminder に「2回読む：〜」と書く。
  E：hint に、必要な公式・用語・知識を1〜2行で示し（教え直し）、それを使えば解ける基本問題にする。
  F：hint に、解き方の最初の一歩（何から考えるか）を1〜2行で示し、小問(1)(2)で段階的に考えられる問題にする。
・A〜D の hint は空文字、E・F の reminder は空文字にする。
・A4一枚に収めるため、問題文は短く簡潔に。長文読解は全文を作り直さず、短い文や一部分を使った問題にする。
・選択問題は choices に選択肢を入れる（記号は付けない。プリント側で ア・イ・ウ・エ を付ける）。選択肢がなければ空の配列。
・answer_lines は答えを書くのに必要な行数（1〜4）。計算・記述で途中式が必要なら多めに。

■図
・図が必要な問題は svg に図を入れる。幅 240 以下・高さ 160 以下の viewBox を持つ、シンプルな白黒の線画の <svg> 要素1つ。文字は font-size 12 前後。図が不要なら空文字。

■書き方
・数式は $...$ で囲んだ LaTeX で書く（例：$2x+3y=7$、$\\frac{1}{2}$、$\\sqrt{3}$）。数式以外の日本語や英文は $ で囲まない。
・下線部が必要なときは <u>…</u> で囲む（例：She has <u>two</u> cats.）。それ以外のHTMLタグは使わない。
・explanation は、生徒が一人で読んで分かるように、要点を2〜4行で書く。
・advice には、今回のミスの傾向と、次に気をつけることを、生徒に向けて2〜3文で書く。`;

const extractSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'notes'],
  properties: {
    notes: { type: 'string', description: '読み取れなかった部分など、先生への注意。なければ空文字' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['photo', 'number', 'subject', 'unit', 'question', 'student_answer', 'correct_answer', 'mark', 'mistake_type', 'mistake_reason', 'needs_figure'],
        properties: {
          photo: { type: 'integer', description: '何枚目の写真か（1始まり）' },
          number: { type: 'string', description: '問題番号（例：大問2(3)）' },
          subject: { type: 'string', enum: ['国語', '数学', '英語', '理科', '社会'] },
          unit: { type: 'string' },
          question: { type: 'string' },
          student_answer: { type: 'string', description: '生徒の答え。空欄なら「（空欄）」' },
          correct_answer: { type: 'string' },
          mark: { type: 'string', enum: ['✗', '✓', '無印'] },
          mistake_type: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F'] },
          mistake_reason: { type: 'string' },
          needs_figure: { type: 'boolean' },
        },
      },
    },
  },
};

const generateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['problems', 'advice'],
  properties: {
    advice: { type: 'string' },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'unit', 'mistake_type', 'reminder', 'hint', 'question', 'choices', 'svg', 'answer_lines', 'answer', 'explanation'],
        properties: {
          source: { type: 'integer', description: 'もとにした間違い問題の番号（1始まり）' },
          unit: { type: 'string' },
          mistake_type: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F'] },
          reminder: { type: 'string' },
          hint: { type: 'string' },
          question: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          svg: { type: 'string' },
          answer_lines: { type: 'integer' },
          answer: { type: 'string' },
          explanation: { type: 'string' },
        },
      },
    },
  },
};

async function toApiImage(base64Data) {
  const buffer = Buffer.from(base64Data, 'base64');
  const resized = await sharp(buffer)
    .rotate()
    .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: resized.toString('base64') },
  };
}

class UserFacingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function errorMessage(err) {
  if (err instanceof UserFacingError) return [err.status, err.message];
  if (err instanceof Anthropic.AuthenticationError) {
    return [401, 'APIキーが無効です。新しいAPIキーを .env（Renderの場合は Environment）に設定してください。'];
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return [403, 'APIキーに権限がありません。Anthropic Console でキーの状態を確認してください。'];
  }
  if (err instanceof Anthropic.RateLimitError) {
    return [429, 'API利用制限に達しました。しばらく待ってから再試行してください。'];
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) {
      return [400, 'Anthropic API のクレジット残高が不足しています。Console の Billing でチャージしてください。'];
    }
    return [400, '画像またはリクエストに問題があります: ' + err.message];
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return [504, 'タイムアウトしました。写真の枚数を減らすか、再度お試しください。'];
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return [502, 'Anthropic API への接続に失敗しました。ネットワークを確認してください。'];
  }
  if (err instanceof Anthropic.APIError) {
    return [err.status || 500, `APIエラー (${err.status}): ${err.message}`];
  }
  return [500, 'サーバーでエラーが発生しました: ' + err.message];
}

// 構造化出力（JSON）で Claude を呼び出し、パース済みのオブジェクトを返す
async function callClaude({ system, content, schema, effort }) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === 'refusal') {
    throw new UserFacingError(422, 'AIが回答を控えました。写真や内容を変えて再度お試しください。');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new UserFacingError(502, '出力が長すぎて途中で切れました。写真の枚数や問題数を減らしてお試しください。');
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new UserFacingError(502, 'AIの回答を読み取れませんでした。再度お試しください。');
  }
}

function sendError(res, err, label) {
  console.error(label, err);
  const [status, message] = errorMessage(err);
  res.status(status).json({ error: { message } });
}

// body: { images: string[] (base64 JPEG), grade?: string, subject?: string, memo?: string }
app.post('/api/extract', async (req, res) => {
  const { images = [], grade = '', subject = '', memo = '' } = req.body || {};
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: { message: '写真がありません。' } });
  }
  if (images.length > MAX_IMAGES) {
    return res.status(400).json({ error: { message: `写真は一度に最大${MAX_IMAGES}枚までです。` } });
  }

  try {
    let imageBlocks;
    try {
      imageBlocks = await Promise.all(images.map(toApiImage));
    } catch {
      return res.status(400).json({ error: { message: '写真を読み込めませんでした。JPG または PNG の写真でお試しください。' } });
    }

    const content = [];
    imageBlocks.forEach((block, i) => {
      content.push({ type: 'text', text: `【写真${i + 1}】` }, block);
    });
    const context = [
      grade && `学年：${grade}`,
      subject && `教科：${subject}`,
      memo && `先生からのメモ：${memo}`,
    ].filter(Boolean).join('\n');
    content.push({
      type: 'text',
      text: `${context ? context + '\n\n' : ''}写真の答案から、○がついていない問題（✗・✓・無印・空欄）をすべて抜き出し、ミスの種類を分類してください。写真の順・問題番号の順に並べてください。`,
    });

    const result = await callClaude({ system: EXTRACT_SYSTEM, content, schema: extractSchema, effort: 'high' });
    res.json(result);
  } catch (err) {
    sendError(res, err, '抽出エラー:');
  }
});

// body: { items: object[] (each with count), grade?: string, title?: string }
app.post('/api/generate', async (req, res) => {
  const { items = [], grade = '' } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: { message: '問題が選ばれていません。' } });
  }
  const total = items.reduce((sum, item) => sum + Math.max(1, Math.min(3, Number(item.count) || 1)), 0);
  if (total > MAX_PROBLEMS) {
    return res.status(400).json({ error: { message: `A4一枚に収めるため、類題は合計${MAX_PROBLEMS}問までにしてください（今は${total}問）。` } });
  }

  const list = items.map((item, i) => [
    `【間違い${i + 1}】類題を${Math.max(1, Math.min(3, Number(item.count) || 1))}問作る`,
    `教科：${item.subject}　単元：${item.unit}`,
    `ミスの分類：${item.mistake_type}（${item.mistake_reason || '理由の記載なし'}）`,
    `問題：${item.question}`,
    `生徒の答え：${item.student_answer}`,
    `正しい答え：${item.correct_answer}`,
  ].join('\n')).join('\n\n');

  try {
    const result = await callClaude({
      system: GENERATE_SYSTEM,
      content: [{
        type: 'text',
        text: `${grade ? `学年：${grade}\n` : ''}次の間違いをもとに、弱点補強プリントの類題を合計${total}問作ってください。間違い1から順に並べてください。\n\n${list}`,
      }],
      schema: generateSchema,
      effort: 'high',
    });
    res.json(result);
  } catch (err) {
    sendError(res, err, '作成エラー:');
  }
});

app.use(express.static(path.join(__dirname, 'public')));
// 数式表示用の KaTeX（CDNに頼らず、このサーバーから配信する）
app.use('/vendor/katex', express.static(path.dirname(require.resolve('katex'))));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
  console.log('終了するには Ctrl+C を押してください。');
  console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '設定済み' : '★未設定（.env を作成してください）');
  console.log('APP_PASSWORD:', process.env.APP_PASSWORD ? '設定済み' : '未設定（誰でも使える状態です）');
});
