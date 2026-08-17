# Other concerns check

_Started 2026-08-17 05:38 UTC_

---

## User

Continuing from "ルール確認と動作確認".

## Assistant

We've been refining the shift management app's public recruitment system to enforce strict balance-locking and clarity around editable fields.

Key decisions made:
- Public recruitment locks Tee at promotion time: balance / 10 = max entries allowed. Excess entries are rejected; stopped/deleted entries refund the locked portion.
- Recruitment capacity (人数) is capped at what the current balance affords — both in initial creation and in edit flows. Users cannot exceed this without charging.
- Public recruitment settings (reward, conditions) are editable at any time via "公開募集の設定" modal; editing before publish doesn't charge Tee.
- Three explicit pre-publish confirmations (公開範囲について / 掲載条件の正確性について / TeeRAの責任範囲について) as gated checkboxes.
- A "公開する募集" card at the top of the pre-publish modal shows the exact date/time/content being promoted.

Current state:
Public recruitment flow fully refactored. Balance locking works: users see max entries calced from current Tee, capacity inputs are capped and reject over-limit attempts, locked amounts display clearly. The pre-publish confirmation modal is styled as a legal checklist with 3 substantive sections. Both new and existing (edited) recruitment can only set capacity within affordable limits. All forms now labeled with "編集" buttons where applicable. Bug fixes: handler return statement restored for max-entries input, stale `promoteChecklistAllChecked` state ref removed, inline validation for over-limit attempts.

Open next steps:
None identified — public recruitment, balance locking, and edit flows are complete.

Files: シフト管理アプリ.dc.html

## User

他に気になることない？

## Assistant

_[tool: grep]_

Quickly verifying the confirm-button gating and confirm-submit handler for consistency.

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

Chargeless already since locking happens at promote time — consistent with your decision. One real gap though: `enterRecruitShift` doesn't stop a staffer from applying once `applicants.length >= promoteMaxEntries` (filled count can exceed the locked/paid-for slots). Want me to add that cap check (disable "希望を出す" once full, matching the capacity messaging you already show elsewhere)? Everything else I traced (balance lock math, refund on stop/delete, checklist gating, PDF billing) looks consistent with the documented decisions — the only other known gap is the cross-company overlap check on self-apply, which you've already flagged as intentionally unimplemented.

## User

整えて

## Assistant

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

`enterRecruitShift`の定員超過チェックと、募集一覧UIの「満員」表示・ボタン無効化を追加した。

_[tool: ready_for_verification]_

完了。

## User

これでアプリとして作り始めても完成するか確認して

## Assistant

_[tool: grep]_

_[tool: grep]_

This is a UI/UX-complete prototype — data flows, balance-locking math, and screen logic are internally consistent (confirmed by the checks above). But as a spec to "start building the real app" from, a dev team hits gaps this prototype doesn't need to answer but a production build will:

**No backend/auth model** — login/register just flips local state; no real session, password hashing, multi-device sync, or role/permission enforcement server-side.

**Payments are simulated** — credit card "即時反映" and bank transfer "着金確認後に反映" (`confirmBankArrival`) are manually toggled in the UI; no real payment gateway (Stripe/GMO etc.), webhook, or reconciliation logic exists.

**Tee wallet is shared per company** in-memory (`ticketRemaining` single field) — you've already decided to defer per-entity wallet separation for 派遣元/派遣先, but a real build needs a ledger table (charges, locks, refunds, PDF-issue debits) instead of ad-hoc state mutations, or double-charges/race conditions will appear with concurrent users.

**Invite flow generates a fake URL** (`https://workflow.app/invite/${token}`) with no real destination/account-linking, as already logged as a known limitation.

**No overlap check on staff self-apply** (`applyToShift`/`enterRecruitShift`) — already flagged as a known gap.

**PDF generation isn't real** — issuance just flips `issued` flags in state; actual PDF rendering/storage/email-LINE delivery isn't built.

Net: solid as a functional/UX spec (flows, edge cases, and business rules are well-defined and consistent) — but it's a frontend simulation over local state, not a system with real auth, payments, or persistence. Those are expected next steps for an engineering build, not bugs in the prototype itself.

## User

それは全て指示書として出せば問題ないでしょ？

## Assistant

はい。UI/フロー/ビジネスルールはこのプロトタイプが実質的な仕様書になっているので、そのまま指示書として渡せます。ただし前回挙げた項目（認証、決済連携、Teeウォレットの台帳化、招待URL、重複チェック未実装、PDF実発行）は「プロトタイプでは意図的に省略・簡略化した部分」として指示書に明記しておくべきです。実装者がそこを「仕様通り」と誤解しないように、CLAUDE.mdの決定事項・制約セクションをそのまま添付するのが確実です。

## User

cloudchordで作るからそれも踏まえて

## Assistant

_[tool: web_search]_

No specific Cloudchord platform info found relevant here — I can't confirm what constraints it imposes on this build. Could you tell me a bit about it (no-code/low-code builder, specific stack, database/auth it provides)? That'll determine what to add or adjust in the handoff doc (e.g. if it has built-in auth/payments, some of the flagged gaps become non-issues; if it's a plain hosting layer, they still need addressing).

## User

何言ってるかわからん
この内容で万人がわかる構造になってる？変な動きされてもバグったりしない？

## Assistant

率直に言うと2つは別の話:

**構造のわかりやすさ**: このファイルは1枚のプロトタイプに全画面・全ロジックが詰まっており、「仕様書」としては動くものが全部見えるので情報の抜け漏れは少ない。ただしコード自体は「万人がわかる」設計書ではなく、変数名・関数名から仕様を読み解く必要がある実装コード。他のエンジニアに渡すなら、これをそのまま読ませるのではなく、画面遷移・データモデル・ビジネスルールを別途文章化した指示書に起こすべき（前回言った「決定事項」「未実装事項」を明記した形で）。生コードだけ渡すと解釈がぶれる。

**変な動きをされた時の壊れやすさ**: プロトタイプの範囲では主要な入力（人数超過、残高不足、定員超過など）にガードが入っていて、意図した操作の範囲では壊れない。ただしこれはプロトタイプ止まりの堅牢性で、実運用で人が「行儀の悪い操作」をした時に耐える保証はない。具体的にまだガードされていない/未検証の点：
- スタッフの自己応募で他社シフトとの時間重複チェックが無い（既知・未実装として合意済み）
- 認証・決済が全部ダミーなので、実装時に不正操作（二重課金、残高マイナス化、同時操作の競合）を防ぐ処理がまるごと必要
- ブラウザのリロード・戻る操作でのstate初期化しか考慮されておらず、実際のDB永続化・エラー時のリトライは未検証

なので「このまま万人向けの構造」ではなく、「動く仕様のリファレンス」として渡し、上記の既知の穴を明記した指示書を別途作るのが安全。その指示書を作りましょうか？

## User

作って

## Assistant

_[tool: copy_starter_component]_

_[tool: dc_write]_

_[tool: ready_for_verification]_

開発指示書.dc.html を作成した。確定業務ルール、変更しない前提、プロトタイプで省略した部分（認証・決済・台帳・招待URL・PDF発行・重複チェック）、実装時の注意点をまとめた印刷可能な文書。

