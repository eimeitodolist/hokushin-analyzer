'use strict';

const express = require('express');
const path    = require('path');
const sharp   = require('sharp');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

const HARDCODED_API_KEY = 'sk-ant-api03-o4cGKf4D2amTrE5Ix-n3_s4JueiTHWGRmSDdu4OWjX4HGXxv0YoGvkSBynNI_BiW19E8XcwKqkHnZZJ3vxJVMA-_bsNjAAA';
const MAX_IMAGE_DIMENSION = 1568;
const JPEG_QUALITY = 85;
const API_TIMEOUT_MS = 60000;

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

async function resizeImageIfNeeded(base64Data, mediaType) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(buffer).metadata();

    const needsResize = metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION;
    const tooBig = buffer.length > 4 * 1024 * 1024;

    if (!needsResize && !tooBig) return { data: base64Data, mediaType };

    const resized = await sharp(buffer)
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    console.log(`画像リサイズ: ${metadata.width}x${metadata.height} → 最大${MAX_IMAGE_DIMENSION}px, ${(buffer.length / 1024).toFixed(0)}KB → ${(resized.length / 1024).toFixed(0)}KB`);
    return { data: resized.toString('base64'), mediaType: 'image/jpeg' };
  } catch (err) {
    console.error('画像リサイズエラー (スキップ):', err.message);
    return { data: base64Data, mediaType };
  }
}

async function processRequestBody(body) {
  if (!Array.isArray(body.messages)) return body;

  const messages = await Promise.all(body.messages.map(async (message) => {
    if (!Array.isArray(message.content)) return message;

    const content = await Promise.all(message.content.map(async (block) => {
      if (block.type !== 'image' || block.source?.type !== 'base64') return block;

      const { data, mediaType } = await resizeImageIfNeeded(block.source.data, block.source.media_type);
      return { ...block, source: { ...block.source, data, media_type: mediaType } };
    }));

    return { ...message, content };
  }));

  return { ...body, system: SYSTEM_PROMPT, messages };
}

app.post('/api/analyze', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || HARDCODED_API_KEY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const processedBody = await processRequestBody(req.body);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(processedBody),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    clearTimeout(timer);
    const message = err.name === 'AbortError'
      ? 'タイムアウト（60秒）しました。再度お試しください。'
      : 'Anthropic API への接続に失敗しました: ' + err.message;
    res.status(500).json({ error: { message } });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'hokushin-analyzer.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
  console.log('終了するには Ctrl+C を押してください。');
  console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY || '(未設定)');
});
