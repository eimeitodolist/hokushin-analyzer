'use strict';

const fs        = require('fs');
const path      = require('path');
const express   = require('express');
const sharp     = require('sharp');
const Anthropic = require('@anthropic-ai/sdk');

// ローカル起動時は同じフォルダの .env から APIキーを読み込む（Render では環境変数を使用）
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const MODEL = 'claude-sonnet-5-5';
const MAX_IMAGE_DIMENSION = 1568;
const JPEG_QUALITY = 85;
const API_TIMEOUT_MS = 180000;
const MAX_IMAGES = 4;

const client = new Anthropic({ timeout: API_TIMEOUT_MS, maxRetries: 2 });

const app = express();
app.use(express.json({ limit: '50mb' }));

const SYSTEM_PROMPT = `あなたは北辰テスト（株式会社北辰図書が実施する埼玉県最大の模擬試験）に精通した塾の先生です。
以下の北辰テストに関する詳細情報を参照して回答してください。

■基本情報
・埼玉県内の中学生の約9割が受験する埼玉県最大の模擬試験
・5教科（国語・数学・英語・理科・社会）各100点満点、合計500点
・試験時間：各教科50分
・埼玉県公立高校入試に合わせた形式・難易度

■実施時期（中3生）年間8回実施（日曜日）
第1回：4月下旬、第2回：6月、第3回：7月、第4回：8月
第5回：9月、第6回：11月、第7回：12月、第8回：1月下旬

■各教科の出題内容
・国語：物語的文章・説明的文章・古文・漢字・語句・課題作文
・数学：計算・関数・図形・データ活用・作図・規則性・証明
・英語：リスニング・長文読解（会話文含む3つ）・英作文
・理科：小問集合・4分野（化学反応式・計算・作図問題含む）
・社会：六大陸三大洋・地形図・時代と文化・資料読み取り記述

■偏差値の見方
・偏差値50＝受験者の平均点
・各教科別偏差値・3教科（国数英）偏差値・5教科偏差値が表示される
・平均点は各教科40〜50点台が多い（難易度高め）

■主な埼玉県公立高校の合格目安偏差値（北辰テスト5教科）
偏差値72以上：浦和高校（県立）、浦和第一女子高校
偏差値70以上：大宮高校（理数）
偏差値68以上：春日部高校、川越高校、越谷北高校（理数）
偏差値65以上：熊谷高校、川越女子高校、蕨高校
偏差値63以上：浦和西高校、所沢北高校、越ヶ谷高校
偏差値60以上：川口北高校、草加高校、春日部女子高校
偏差値57以上：所沢高校、上尾高校、川口高校
偏差値55以上：浦和北高校、与野高校、川越南高校
偏差値50以上：一般的な公立高校の目安

■私立高校の確約制度
・北辰テストの偏差値をもとに私立高校が「確約」を出す制度（合格をほぼ保証）
・第4回（8月）〜第6回（11月）の結果が重視される
・慶應志木・早大本庄・立教新座などトップ私立は確約なし

■A〜E判定の目安
A判定：合格可能性80%以上（安全圏）
B判定：合格可能性60〜79%（ほぼ安全圏）
C判定：合格可能性40〜59%（ボーダーライン）
D判定：合格可能性20〜39%（努力圏）
E判定：合格可能性20%未満（要努力）

■成績表の見方
・個人成績票：各教科の点数・偏差値・順位が記載
・学習到達度グラフ：単元ごとの正答率が棒グラフで表示
・志望校判定：登録した高校のA〜E判定が表示
・正答率が高い（50%以上）のに自分が間違えた問題＝最優先復習問題`;

async function toApiImage(base64Data) {
  // ブラウザ側で JPEG 化済みだが、念のためサイズを上限内に収める
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

function errorMessage(err) {
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

// body: { prompt: string, images: string[] (base64 JPEG), maxTokens?: number }
app.post('/api/analyze', async (req, res) => {
  const { prompt, images = [], maxTokens = 8000 } = req.body || {};
  if (typeof prompt !== 'string' || !prompt) {
    return res.status(400).json({ error: { message: 'prompt がありません。' } });
  }
  if (!Array.isArray(images) || images.length > MAX_IMAGES) {
    return res.status(400).json({ error: { message: `写真は最大${MAX_IMAGES}枚までです。` } });
  }

  try {
    let imageBlocks;
    try {
      imageBlocks = await Promise.all(images.map(toApiImage));
    } catch {
      return res.status(400).json({ error: { message: '画像を読み込めませんでした。JPG または PNG の写真でお試しください。' } });
    }

    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: Math.min(Number(maxTokens) || 8000, 16000),
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: { message: 'AIが回答を控えました。写真を変えて再度お試しください。' } });
    }

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    if (!text) {
      return res.status(502).json({ error: { message: 'AIから回答が得られませんでした。再度お試しください。' } });
    }
    res.json({ text, truncated: response.stop_reason === 'max_tokens' });
  } catch (err) {
    console.error('分析エラー:', err);
    const [status, message] = errorMessage(err);
    res.status(status).json({ error: { message } });
  }
});

// 画面（HTML）だけを配信する。server.js や .env が外から見えないよう、フォルダ全体は公開しない
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'hokushin-analyzer.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
  console.log('終了するには Ctrl+C を押してください。');
  console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '設定済み' : '★未設定（.env を作成してください）');
});
