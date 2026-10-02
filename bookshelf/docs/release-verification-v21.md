# version21 検証・引継ぎ記録（2026-09-30 JST）

## 公開・コード・既存データ
- URL: https://pdf-page-finder.yutaro1016.chatgpt.site/shelf
- 公開version21 / deployment appgdep_6abcbd2f5bf481918791c485afc25111 succeeded
- Sites source: 3bd2e16b18d701c04db49fc30282418422c9afb0
- GitHub code: 2268d5d1128201c872da92aacc2c14f2308832cf
- branch: feature/digital-bookshelves / PR#1 Draftを継続
- CI: https://github.com/yutaro1016-ops/PDF-/actions/runs/36684924251 / run124 / verify109788462029 completed success
- CI checkout: PR merge 5de1e51（2268d5d1128201c872da92aacc2c14f2308832cfを取り込んだ状態）。全step成功、ログの試験結果も確認。
- 公開後HTTP200、ok=true、version21。これはDB/R2疎通であり、登録・閲覧・検索UIの実ブラウザー確認とは別。
- 公開前後の全返却行を照合：books53、shelves9、account_lifecycle0、storage_operations0が不変。値の切詰めなし。PDF本体・索引の本番全量ハッシュ比較は権限不足で未実施。
- 本番environment entries0 / env revision0。CAPACITY_ENFORCED、ACCOUNT_DELETION_ENABLED、STORAGE_OPERATION_GUARD_ENABLEDは未設定時のfalseを維持。設定変更なし。
- 新migrationなし、既存PDF ID/本体/索引/棚の削除・再登録・置換なし。Sites checkout clean。
- 着手時、公開版20/Sites source79b5942、GitHubは前回コードから検証記録ddcbce3だけ追加されていた。前回以降のアプリ差分はなく、その記録をSitesソースにも保全。
- GitHubへコード/試験/運用資料を保存し、同じソース内容を既存Sitesへ手動公開。この最終記録はGitHubにのみ追加するため、公開アプリの内容は上記コードコミットに対応する。自動公開は未導入。
- 販売・課金・外部契約・問い合わせ/招待/通知送信・本番強制解除・環境切替はしていない。監視受信設定/到達/契約枠/費用は未確認。無料運用を保証しない。

## 変更
1. 保存barrier取得後の例外で、結果不明のR2書込みが後から完了する可能性を残したままロックを解除していた。例外時はkindをuncertain:元操作にし、token行を保持するよう修正。PDF PUT、multipart開始/part/complete/abort、画像PUT、PDF DELETE、共有取り込みadvance/cancel、退会advanceが対象。共有advance内の捕捉例外も対象。
2. 共有取り込みの内部例外を生のmessageで返さず、共通storageError/serverErrorを使う。既存の公開503形式・問い合わせIDと機密を含めないログへ統一。
3. 新tests/storage_crash_test.mjsをActionsへ追加。ローカルnative workerdの未完了リクエストをfinally前に停止（Miniflare dispose）、永続D1で再起動し、barrierが残ることを確認。
4. SQLite+模擬R2試験にエラー後遅延commit、DBへupload IDを記録する前の障害とabort失敗による孤立multipartを追加。時間による解除なし、復旧には試験fixtureの実際の下流終了/全件列挙確認を必要とする。
5. docs/support-inquiry-ready.mdに貼り付け用日本語問い合わせと公式窓口操作、docs/user-acceptance-checklist.mdに端末/別アカウントの操作・提出書式を用意。既存4資料とstorage-operation-recovery.mdへ引継ぎを追記。

本番guard/退会はOFFなので、保守的な停止処理は本番の通常並行保存を変更しない。正式な復旧能力を受け入れるまで有効化しない。公開用解除API/自動タイムアウト/cronは追加していない。

## 実際に確認した結果
|項目|結果と実行範囲|
|---|---|
|worker終了/再起動|ローカルnative workerdを未完了要求中にdispose。finally前のbarrierが永続D1に残り、再起動後も同一利用者409・別利用者200。Sites本番の強制停止権限やR2の停止保証ではない|
|R2結果不明|模擬putが503を返す一方で下流Promiseが生存し遅延commit。退会advanceはcommit前後とも409で止まり、deletedにならない。Promiseをjoinして終了を証明した試験専用確認後に解除・再開し、deleted後の本体再出現なし|
|孤立multipart|模擬作成成功→DB upload ID保存失敗→abort失敗で、DBにIDなし・ストレージにuploadありを再現。barrierが残り退会完了を拒否。試験Mapの一覧権限でIDを照合・abort後に試験専用解除し清掃。Sitesでは一覧/中止/終了確認権限が未確認|
|abort後DB障害|barrier保持を確認。停止した同期模擬処理の終了確認後にのみ再開し、10024による冪等清掃が成功。本番の自動解除ではない|
|既存競合回帰|PDF/画像/共有コピー/退会削除の処理停止、旧120秒lease期限切れ、二重実行、古いbarrierの奪取拒否が成功。経過時間だけで引継がない|
|FixedLengthStream|native workerd/local R2で通常PUT/multipart、長短ストリーム拒否、旧unknown-length wrapperの拒否回帰、abort再実行が成功。v20修正を維持|
|大容量|Actionsで32/128/512MiBから1073738978byteまでdisk-backed API試験が成功。8MiBパート、SHA256一致、中断/再試行、索引/検索。range読出し128226byte以下。3ページ・未参照padding中心。本番R2/実端末ではない|
|多数ページ/画像|自作2000ページ562138byteの抽出/描画/API索引・検索と、自作画像24ページ12360893byteの抽出/描画が成功。本番登録/ブラウザーの画像表示確認ではない|
|主要回帰|移行、独立ローカル復元、所有者制約、共有/取消/独立コピー、各対象検索、容量予約、100冊操作、表紙/色、フォルダー模擬書出し/中断/再開、型、ビルドがActionsで成功|
|本番反映/疎通|deployment succeeded、HTTP200/ok=true/version21、上記4表の返却メタデータ不変。実機機能確認は未実施|

模擬/ローカル試験だけで本番の消去保証、バックアップ復旧、端末操作、通信障害耐性を確認済みとしない。

## 前回から解消されたこと
- 結果不明エラー時にbarrierを解放してしまうコード経路を、安全側に保持する処理へ変更した。
- ローカル実workerd終了/再起動、遅延commit、ID未記録multipartの新しい再現試験とCI証跡を追加した。同じ模擬試験の再実行だけで終了していない。
- 正式窓口の具体的な操作と送信用問い合わせ文、実端末の結果提出手順を整えた。

## 未解消・販売保留の理由
- 本番DB/R2全量export、復旧点/保持期間、原本を変更しない独立復元、自動バックアップ・暗号化・世代管理・失敗通知。利用可能なSitesツールはDB行の読取等であり、正式export/restoreと管理資格情報は公開されていない。機能が存在しないと断定せず、権限/手順未確認とする。Cloudflare一般機能を推定適用しない。
- Sites実worker/下流R2操作終了の証明、孤立multipartの列挙/中止、残るbarrierの正式な解除。模擬Mapの管理権限は本番権限ではない。時間経過・ログなしだけで解除しない。
- 本人の直近再認証API、退会完了の正式照合/証跡、バックアップ内消去期限、復元時の削除tombstone別系統保管・再適用。nonceは再認証の証明ではない。
- PC/タブレット/スマホの実ブラウザー、許可専用A/Bアカウントによる本番分離・共有・書出し・ドラッグ/タッチ・3領域操作。
- 表紙画像未反映の利用者症状は実画面で再現できておらず未解決。キャッシュ/ローカルPDF描画の試験合格を解決扱いにしない。
- 本番大容量負荷試験、利用枠/費用/専用アカウント、通信断・タブ終了、画像/多数ページの実端末性能。
- 通知受信設定・通知到達・定期監視・正式な非対話自動公開資格情報・実プランの商用条件/費用。

環境指定のSites managed-linux検証手順はcontrol-browser読込を要求し、未提供時に別経路を即興使用しないと指示する。該当ツール/skillが利用可能一覧にないためブラウザーを代用していない。正式環境が利用可能になるか、利用者の実端末結果が必要。
参照: skill://sites@openai-curated-remote/root/.codex/plugins/cache/openai-curated-remote/sites/0.1.75/skills/sites-building/references/preview/managed-linux.md

販売準備完了とは判断しない。本番3フラグはOFF、価格/試用/容量は仮案のまま。

## 次にご本人が行うこと
1. [問い合わせ本文](support-inquiry-ready.md)を確認し、https://help.openai.com/ の右下チャットでSites担当への確認を依頼する。問い合わせ本文の確認時点版20には現在21と補足する。プラン・ワークスペース等は非公開窓口だけへ伝える。こちらから送信はしない。
2. [実端末チェックリスト](user-acceptance-checklist.md)に沿って、許可されたA/B専用アカウント・PC/実タブレット/実スマホを用意し、正常/失敗/未実施を記録する。アカウント・秘密情報・未加工HAR・PDFをGitHubへ貼らない。
3. GitHub受信者がSettings→Notifications→System→Actionsの受信先/失敗通知を確認する。通知到達の試験は明示許可後。請求枠/担当者/予算確認前にcronや外部契約を有効化しない。
4. 正式回答を基に独立領域への全量復元・SHA256/索引/棚/画像照合、worker/R2終了証明と承認された対象token解除の演習を計画する。必要な有料支出・本番置換/切替は事前承認を得る。

## 復旧
v19へ単純に戻さない。FixedLengthStreamを維持する互換版（本番3フラグOFFならv20）を復旧候補にする。DB/本体を巻き戻さず、追加テーブルを削除しない。guard有効化後は非対応版への切戻しを避け、正式な旧要求/下流終了証明を得る。今回本番強制解除や復旧操作は行っていない。
