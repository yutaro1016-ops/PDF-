# version19 最終検証記録（2026-09-30 JST）
- URL: https://pdf-page-finder.yutaro1016.chatgpt.site/shelf
- 公開version19 / deployment appgdep_6abc7eccdb048191b2c6fcf7e6f9f071: succeeded
- Sites source: f4d3923077cd536cb98db808e07cd4941fb2543a
- GitHub code: 684ece5b1b8648267850e9490291a3e02167900f
- branch: feature/digital-bookshelves / PR#1 Draftを継続
- GitHub Actions: https://github.com/yutaro1016-ops/PDF-/actions/runs/36663478844 / verify job109723071136 completed success
- PR merge checkout28542e5: npm依存、PDF.js200資産再現、移行/独立復旧/色/表紙/フォルダー/受信ストリーム/実PDF/共有・API試験、型、ビルド、公開前healthが成功。
- 公開後: 既存監視と同じAccept・User-AgentでHTTP200、ok=true、version19。ヘッダーなしurllibでは403だった。実ブラウザーの動作保証ではない。
- 公開前後の読み取り照合: books53 / shelves9 / account_lifecycle0、全返却行の値に差分なし。v18報告の52冊から増えている既存変更を保全。PDF本体/索引の本番全量ハッシュ照合ではない。
- 環境変数entries0。CAPACITY_ENFORCED / ACCOUNT_DELETION_ENABLEDは既定false。販売・課金・退会・本番容量制限を開始していない。
- DB migrationなし、既存PDF/索引/棚の削除・置換なし。公開URL/公開範囲維持。ソースcheckout clean、v18報告をソースにも保全。
## 変更と実際の検証
通常/分割アップロードに実受信バイト長のストリーム照合を追加。宣言を超える/不足する本文、途中切断を保存成功にしない。reader cancellation/releaseを試験。API回帰試験も成功。
新しいdisk-backed大型試験で、自作3ページの有効PDF32/128/512MiB/約1GiBを実route処理へ登録→8MiBパート以下保存→保存前後SHA256→PDF.js range取得/本文抽出/第1ページ実描画→索引登録→全/指定/複数検索を確認。
|段階|実バイト|パート数|閲覧/抽出range読出し|結果|
|---|---:|---:|---:|---|
|32MiB近傍|33551582|4|128222|合格|
|128MiB近傍|134214880|16|128224|合格|
|512MiB近傍|536868064|64|128224|合格|
|1GiB上限未満|1073738978|128|128226|合格|
最大試験SHA256: 9da06c0876407f1d4afc5339495c8a592046e4908534e2d32366b05961e4e076。
本文3ページ既知ヒットと表紙の非白色pixelを確認。途中パートのstream error→同パート再送、応答喪失想定の再送、R2相当commit後DB失敗→再試行で二重commitなし。
保存アダプターはローカルディスク、DBはSQLite。Node PDF.jsであり実ブラウザー/本番R2/実通信の検証ではない。未参照padding中心なので画像満載/数千ページPDFの負荷を代表しない。
既存の利用者分離/共有取消/独立コピー/容量予約/二重退会開始/障害再開の模擬統合試験と、自作PDFの独立ローカル復旧、フォルダー保存模擬試験も再実行合格。

## 未確認・未実装と販売保留
本番全量DB/R2export、復旧ポイント/保持期間/正式権限、独立本番復元・暗号化自動取得・失敗通知は未確認。正式な利用可否の質問/権限はplatform-confirmation-request.md（未送信）。Cloudflareの一般機能を利用可能とは推定しない。
実ChatGPT別アカウント、PC/タブレット/スマホ実ブラウザー、3領域/ドラッグ/タッチ/画像未反映/書き出し実操作、本番1GB登録は未確認。準備はbrowser-acceptance-plan.md。
退会と長時間R2書込、120秒lease引継ぎ後の旧処理、multipart abort後DB障害は未解決。今回の受信長修正では解決しない。直近再認証、バックアップ内消去期限、完了通知も未確定。
定期監視は未稼働、GitHub通知受信設定/到達/請求枠は未確認。外部契約なし。GitHub→Sites非対話公開の正式資格情報は未確認。手動認証済み同Site公開を使用。
問い合わせ・通知を勝手に送信していない。外部契約/有料サービス/既存データ削除/本番置換/環境切替なし。
販売準備完了とは判断しない。次回は上記文書を読み、正式復旧権限/許可テストアカウント/指定ブラウザー操作環境を確保し、独立環境で退会書込競合を修正・障害注入する。再認証/保持方針なしに本番フラグを有効化しない。
ロールバック: 保存済みv18archiveを同Siteへ再デプロイ。DB/R2置換・migration巻戻し不要。実施前には現在の新しい変更を保全する。
