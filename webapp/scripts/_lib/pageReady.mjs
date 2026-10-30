// アプリの画面を開いた直後は、データがそろうまで読み込み画面（ロゴの木、
// src/app/loading.tsx）が先に出る。フォーム送信後の画面移動などでは
// waitForURLがその時点で戻ってくるため、本体の中身を読む前にこれで待つ。
export async function waitForPageReady(page) {
  await page.locator('img[src="/splash/tree.webp"]').waitFor({ state: "detached", timeout: 30000 });
}
