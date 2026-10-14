import { execSync } from "node:child_process";

// マジックリンク登録に伴い、全スモークテスト共通の「アカウント作成直後に
// パスワードを入力して即ログイン」という前提が崩れたため、代わりに
// devログ（RESEND_API_KEY未設定時のフォールバック出力）からマジック
// リンクのURLを拾って訪問するヘルパー。既存のsmoke-account-security.mjs
// 等が使っているトークン抽出パターンと同じ方式。
//
// registerAction等のサーバーアクション自体の所要時間はTurbopackの初回
// コンパイル有無で数百ms〜1秒以上とばらつくため、固定waitの直後に1回
// だけ読むのではなく見つかるまでポーリングする。既存の全呼び出し側が
// `await X.goto(extractMagicLinkFromLog())`という同期関数前提の形で
// 一括置換済みのため、ここはasyncにせず（execSyncの）同期ループで待つ。
export function extractMagicLinkFromLog() {
  const re = /\/magic-link\/([A-Za-z0-9_-]+)/g;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const logText = execSync("tail -c 200000 /tmp/nextdev.log").toString();
    const matches = [...logText.matchAll(re)];
    if (matches.length) {
      return `http://localhost:3000/magic-link/${matches[matches.length - 1][1]}`;
    }
    execSync("sleep 0.2");
  }
  throw new Error("devログにマジックリンクが見つかりません（10秒待っても見つからず）");
}
