# version20 検証・引継ぎ記録（2026-09-30 JST）

## 公開・ソース対応
- URL: https://pdf-page-finder.yutaro1016.chatgpt.site/shelf
- 公開version20: deployment appgdep_6abcb58c92fc8191af54548cc96cefd1 succeeded
- Sites source: 79b594276e53916001e78d322365220aaa87eda3
- GitHub code: fecdf0960188eadd1270c9db6696b037e3967f69
- branch: feature/digital-bookshelves / PR#1 Draftを継続
- CI: https://github.com/yutaro1016-ops/PDF-/actions/runs/36681879626 completed success / run122 / verify109778892989
- CIのPR merge checkout:079ee46。依存取得、PDF.js200資産再現、既存・追加試験、型、ビルド、公開前healthがすべて成功。
- 公開後、既存監視ヘッダーでHTTP200・ok=true・version20を取得。DB/R2疎通確認であり、登録/閲覧/検索UIの実ブラウザー確認ではない。
- 公開前後で全返却行を照合: books53/shelves9/account_lifecycle0が不変。新storage_operations0。PDF本体/索引の本番全量ハッシュ比較ではない。
- production environment entries0。CAPACITY_ENFORCED、ACCOUNT_DELETION_ENABLED、STORAGE_OPERATION_GUARD_ENABLEDは既定falseのまま。
- ソースcheckout clean。GH4697798のv19記録もSitesソースに保全。既存ID/本体/索引/棚の削除・再登録・置換なし。schema-onlyの空テーブル追加だけ。
- 販売/課金、外部契約、問い合わせ送信、環境切替、定期監視/自動公開の有効化はしていない。実際の請求・残枠は未確認で、運用費ゼロを保証しない。

## 修正
1. v19のexpectedLengthBodyはplain JS stream wrapperでknown lengthを失った。native workerd/local R2で拒否を再現。WorkersではFixedLengthStreamへ切り替え、実受信長の検証とR2互換性を両立。通常保存/multipart part両方に適用。Nodeディスクアダプター試験だけでは検出できなかった問題。
2. R2変更入口へ利用者単位の永続barrierを追加。時間だけで奪取しない。退会有効時は全R2書込も必ずbarrierを使う。本番では追加guardも無効。停止したworker/下流処理の正式な終了確認・解除権限が未確認なので、通常の本番並行性は変更していない。
3. import cancelのabort障害を握りつぶして成功とする処理を修正。公式NoSuchUpload10024だけ再試行成功扱い。一般障害/generic404は伝播。abort後DB障害の再試行も検証。
4. Drizzle0006_blue_lenny_balingerでstorage_operations(user_id PK,token,kind,created_at)追加。既存migration/snapshotを改変せず、新journal/snapshotを追記。

## 実際に確認した項目
|項目|結果・実行環境|
|---|---|
|R2ストリーム互換性|native workerd/local R2の通常PUT/multipart、長短本文拒否、旧generic stream拒否理由、abort再実行が成功。本番R2ではない|
|退会と保存|SQLite+模擬R2でPDF PUT・thumbnail PUTを処理途中に停止→退会開始→advance409で待機→保存完了→退会再開→本人prefix/対象行なしを確認|
|期限切れ旧import|旧処理をR2 uploadPart中に停止しlease_untilを過去へ変更。重複advance/cancel409、退会advance待機、旧処理終了後の取消/退会清掃が成功|
|期限切れ旧closure|R2 delete中に停止しclosure leaseを過去へ変更。二重advance409、旧処理完了後再開が成功|
|abort障害/再開|一般abort失敗でpending維持、abort成功後DBチェックポイント失敗、NoSuchUploadを伴う再試行、最後のcancelled状態を確認|
|残るbarrier|created_atが古くても奪取しない。違うtokenでは解放できない。別利用者の取得/解放は独立|
|2000ページPDF|自作562138byte。SQLite+模擬R2へ登録/保存、実PDF.js全2000ページ抽出→5ページずつ索引保存→indexed_pages2000→最終ページの指定検索ヒット。別試験で1/2000ページ実描画|
|画像PDF|自作JPEG24枚を埋め込んだ12360893byte/24ページ。同じPDF.jsで全ページ文字抽出と最初/最後のJPEG描画。画像PDFの本番登録・ブラウザー試験ではない|
|1GiB近傍|32/128/512MiBから1073738978byteまでdisk-backed API試験合格。8MiB/part、元/保存SHA256一致、3ページ抽出/検索/表紙range読出し128226byte以下。未参照padding中心|
|既存主要回帰|所有制約、共有/取消/独立コピー/再開、複数対象検索、100冊操作、容量予約、無効退会/nonce/二重開始/障害後再開、フォルダー模擬中断/再開、独立ローカル復旧、表紙/色/移行試験が合格|

競合試験は実時間120秒や実通信ではなく、Promiseで旧処理を停止したままDB leaseを期限切れへ変更する決定的な障害注入。患者情報・他人のPDF・既存利用者は使用していない。native workerd試験も本番へ接続しない。

## 未確認・販売保留
- 本番DB/R2全量export、復旧ポイント/保持期間、独立復元、暗号化自動取得/世代管理/失敗通知。利用ツールに正式操作が引き続き公開されず、Cloudflare一般機能から推定していない。platform-confirmation-request.mdの質問は未送信。
- PC/タブレット/スマホの実ブラウザー、許可された実ChatGPT別アカウント、3領域・ドラッグ/タッチ・共有・書き出しUI、表紙未反映の利用者症状。本環境指定control-browserが利用可能一覧になく、別操作経路で代用していない。
- 本番大容量登録、画像/多数ページPDFの実ブラウザー性能、実通信断/タブ終了。
- R2応答後の結果不明commit、実worker強制終了、DBへID保存前の孤立multipart、残るbarrierの正式解除/権限/演習。ローカル試験合格は本番での完全な再出現防止保証ではない。
- 本人の直近再認証、バックアップ内消去期限、完了通知・監査保持。本人ID+nonceは直近再認証の証明ではない。
- GitHub通知受信設定・到達、現プランの枠/費用、定期監視、正式な非対話Sites公開資格情報。既存認証済み同Siteの手動公開を使用。

販売準備完了とは判断しない。本番退会/容量/guardは有効化しない。

## 次の操作
1. platform-confirmation-request.mdに沿って正式export/復旧/保持/権限、worker・下流R2終了確認、孤立multipart管理を運営元へ確認（送信は明示指示後）。
2. 許可テストアカウントA/B/C・正式control-browserまたは利用者の実端末試験を準備し、browser-acceptance-plan.mdを実行して結果/証拠を記録。
3. 独立領域でstorage-operation-recovery.mdの停止/解除/結果不明処理を演習。安全に解放できる運用が揃うまでguard/退会を有効化しない。旧版非対応requestの終了も確認。
4. 正式全量バックアップと独立復元・通知到達・本人再認証/消去方針を受入後に販売判断。
ロールバックでv19へ単純に戻すとknown-length欠陥が再発する。FixedLengthStreamを維持した互換修正版を用意し、新テーブルを削除/本番DBを置換しない。
