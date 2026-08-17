# 権限名と設定の問題

_Started 2026-08-06 07:24 UTC_

---

## User

本部の管理者、編集者、チームのマネージャー、リーダーって権限名のはしょらないで
チームの切り替えもないし
あと設定に契約書の欄消えてる

## Assistant

_[tool: grep]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: grep]_

No comparisons elsewhere on team role strings—safe to rename. Now I'll investigate the "team switching" and "契約書 in settings" issues.

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: read_file]_

Placement is correct — 契約書管理 (list) now sits right after 雇用契約書管理 (templates) inside 設定, both reachable.

Now the permission label renames and the Dashboard team switcher.

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

Now add a team switcher to the Dashboard, reusing the existing team-filter state/logic already used on the Staff page.

_[tool: dc_html_str_replace]_

_[tool: grep]_

Good — kpiCards is derived from `vacancyShifts`/`pendingEntryShifts` etc., which use `shiftVisibleToViewer`/`effectiveTeamId`, so the switcher will actually filter the dashboard. Let's verify visually.

_[tool: ready_for_verification]_

3つ修正した:
- 権限名を省略しない表記に変更(本部管理者/本部編集者、チームマネージャー/チームリーダー)
- 設定タブ内の「契約書管理」欄が導線から外れて表示されなくなっていたのを復元(雇用契約書管理の下に表示)
- ダッシュボードにチーム切り替えセレクタを追加(スタッフ/カレンダーと同じ仕組みで絞り込み可能)

## User

これってリーダーはできないはずだよね？他にも権限で制御しているのにせいぎゃされていないものがないかチェックして

## Assistant

_[tool: grep]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: eval_js]_

_[tool: update_todos]_

利用上限が近いため、ここで一旦止めます。

確認結果:
- ご指摘の「✎ 所属チームを編集」ボタンは実際にはリーダーとして表示中は表示されません(`viewerIsCompanyWide`のみで制御、チーム閲覧時は非表示)。ただしマネージャーとして表示中も同様に非表示になっており、マネージャーが行えるべき操作まで一律ブロックされている可能性があります。
- 他の権限制御(契約書発行・請求書作成・請求閲覧など`viewerCanIssueContracts`等)は一通り洗い出しましたが、実際に「制御漏れ」があるかまでは検証しきれていません。

続きが必要な場合は「進めて」と言ってください。他の権限制御箇所の網羅チェックを続けます。

## User

管理者画面で作った制御が正しい。

## Assistant

了解、管理者画面(設定タブ)の権限制御は現状のロジックを正しいものとして扱います。追加の修正は行いません。

## User

指示書メモに残しておいて。①派遣先画面と管理者画面はほとんど同じ構造で、派遣先画面のメインカラーは青系、管理者画面は緑系。②業務報告の承認は基本派遣先が自社スタッフと派遣スタッフの分をやる。管理者画面（派遣会社側）では自社で勤務した稼働分は承認対応するが、派遣先で勤務した分は承認はしない、派遣先とスタッフのやり取りを見ているだけ。ただし、仮アカウントの場合は管理者画面で行う。③派遣先も仮アカウントで派遣会社を登録して派遣スタッフを仮アカウントへ所属させることができる→所属することにより派遣先でシフト作成の際に派遣スタッフ分も出るし、承認対応等ができる④派遣会社側は請求書発行するが、派遣先は請求書発行はしない⑤派遣先も派遣会社も契約書はリーダー以外が操作でき、リーダーは閲覧のみ（ダッシュボードも適用だがまだ実装されていない）⑥ざっくりはこの画面で決まっているが中の権限や制限がうまく実装できていないので都度確認が必要⑦やることリストの誰宛かは本部またはチームのメンバーのみ選択可能（そもそもやることリストが会社アカウント独自のシステムのため）

## Assistant

