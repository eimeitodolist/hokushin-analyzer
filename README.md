# 北辰テスト 成績分析

北辰テストの成績表写真をアップロードするだけで、AIが各教科の偏差値を読み取り、LINEで送れるフィードバックメッセージを生成します。

## 機能

- 成績表写真から偏差値・点数を自動読み取り
- 正答率50%以上なのに自分が間違えた問題を「優先復習単元」として特定
- スマホカメラで直接撮影して即分析
- LINEにそのままコピーできるフィードバック文を生成

## ローカルで起動する

```bash
npm install
ANTHROPIC_API_KEY=your_api_key node server.js
```

ブラウザで `http://localhost:3001` を開いてください。

## Render にデプロイする手順

### 1. GitHubリポジトリを作成

```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/YOUR_USERNAME/hokushin-analyzer.git
git push -u origin main
```

### 2. Renderにサービスを作成

1. [https://render.com](https://render.com) でアカウントを作成（無料）
2. ダッシュボードの **New → Web Service** をクリック
3. GitHubリポジトリを選択して接続
4. 以下の設定が自動で読み込まれます（`render.yaml` による）:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### 3. 環境変数を設定

Renderのサービス設定画面 → **Environment** タブで追加:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` (Anthropic APIキー) |

### 4. デプロイ

**Deploy** ボタンを押すと自動でビルド・起動されます。  
完了後に表示される `https://hokushin-analyzer.onrender.com` のようなURLにアクセスできます。

> **注意**: Renderの無料プランはアクセスがない状態が続くとスリープします。  
> 初回アクセス時は起動に30秒ほどかかる場合があります。

## 必要なもの

- [Anthropic APIキー](https://console.anthropic.com/)（Claude claude-sonnet-4-5 を使用）
- Node.js 18以上（ローカル起動の場合）
