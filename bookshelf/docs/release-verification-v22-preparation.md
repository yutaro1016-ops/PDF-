# version22継続・販売前移行準備の検証記録（2026-10-01）

## 公開・GitHub対応
- 公開アプリ: version22 / https://pdf-page-finder.yutaro1016.chatgpt.site/shelf （維持、今回は再deployなし）
- Sites source: 9e7e66478dd21b644944e4867909810da9356fb9 / deployment appgdep_6abcf30550908191bd72b0e0a72a9f61 をget_site/versionで再確認。
- 公開アプリのコード対応: 9001c9318222a852412ca86a244d901976bc37cc。
- 開始時GitHub: 0505f267c4cbf0168db24a932fc0fbd628fafa53。compareはidenticalで、他者の追加変更なし。
- branch: feature/digital-bookshelves / PR#1 Draft（merge/公開先変更はしていない）。
- offline tools commit: af6271ce48dfc60c90b2f5ee8eea118b99fdc766。
- 比較/移行資料とDBdump転送料修正: e8e2051235760c734988381dc153b51a3c405ddd。
- 最終記録は上記に続くdocs-only commit。今回のGitHub差分はscripts/tests/examples/docs/.gitignore/Actionsのみ。app/public/drizzleと稼働アプリに差分なし。Sitesへの自動公開を設定せず、独立準備を公開変更と混同しない。
- prod environment revision0/entries0。CAPACITY_ENFORCED / ACCOUNT_DELETION_ENABLED / STORAGE_OPERATION_GUARD_ENABLEDは既定falseを再確認、変更なし。
- PDF ID/本体/索引/棚に書込・削除・再登録なし。本番全量hash照合は未実施。

## 追加・変更したもの
1. scripts/migration-bundle.py: 完了した本人exportのPDF/index/metadata/inline表紙をSHA256 manifest化し、独立ローカルSQLiteへ復元して内容を比較。既存出力先拒否、未知列の黙示消失拒否、pending/重複/foreign shelf/symlink拒否、失敗時の自作stageのみ清掃。network/本番write機能なし。productionReady=falseと不足scopeを必ず報告。
2. scripts/hosting-cost-estimate.pyと計算テスト: 10/50/100人×平均1GB/上限5GB、backup2世代+DBdump、DBサイズ仮定5%、日次Supabase dump転送、円換算仮定150を再現。D1単一10GB超過を警告。
3. examples/migration-staging.json.example: 全フラグOFF、認証対応未設定・access disabled、復旧目標/保持提案のみの設定例。credentialなし。
4. managed-hosting-comparison.md: 自分のCloudflare案を推奨候補とし、Supabase Auth/Postgres+R2案と公式資料で比較。契約/課金はしていない。
5. migration-preparation-v22.md: 取得可否の表、8段階の移行/切戻し案、URL制約、本人確認対応とtombstone、最小限の実機提出手順。
6. 既存監査/運用/復旧/チェックリスト/platform質問記録に最新状況を追記。ユーザーはSupport問い合わせ済みで正式復旧能力は未確認、同じ問い合わせの再送を前提にしない。歴史的記録を削除・上書きしない。
7. GitHub Actionsへ新2試験、私有manifest/作業領域のignore追加。PDF/DB/backup/秘密情報はコミットしていない。

## 実施した検証
|項目|結果と範囲|
|---|---|
|新しい移行照合|ローカル7試験・Actions7試験成功。自作1pageの実PDFファイルをID/hash一致で復元し、索引文字列/棚名/順序/タグ/色/inline表紙bytesを比較。表紙fixtureは合成bytesで画像描画の実機試験ではない|
|改変/欠落/保護|同サイズPDF破損、index/表紙変更、未完了・重複ID・未知棚・path traversal・symlink・未知metadata列、既存manifest/復元先を拒否。失敗stageのみ除去、原本/既存先保持|
|費用計算|ローカル/Actions2試験成功。D1容量・年額の月換算売上・保持増加・Supabase DBdump転送を含む。実請求/実負荷測定ではない|
|旧復元互換|ローカル既存backup_restore_test 1試験成功。新toolは旧restoreを再利用、本番書込なし|
|build/構文|ローカルnpm run build、py_compile、git diff --check成功|
|主要回帰/型/再現build|最新Actions https://github.com/yutaro1016-ops/PDF-/actions/runs/36800939886 / run130 / verify110174886964 全step success。7+2試験のログ、型、build完了を確認|
|既存大容量/FixedLengthStream|同Actionsの既存32/128/512/1024MiB・約1073738978byte試験、native local workerd/R2ストリームと再起動barrier、2,000page/画像24page等の回帰が成功。ローカル/合成アダプターの証跡であり本番登録/実ブラウザー成功ではない。新しい理由のない単独再試験はしていない|
|公開疎通|Actionsのhealth-checkがHTTP200/ok=trueを確認して成功。get_site/versionで公開版22/sourceを確認。作業コンテナーの直接HTTPはHTTPErrorで取得できず、その経路ではversion応答を確認していない。実機機能確認とは別|
|DB/権限|正式read_database_overviewで9表/DB binding・projection非切詰めを確認。行全量/私有PDF/索引本文は今回は取得していない。正式全量export/restore/R2 admin資格情報は利用可能ツールになし、機能不存在の断定ではない|

最初のtool commitのActions run128/36800712653/verify110174173354も全step成功。費用修正後は最新run130を受入証跡とする。本記録のみの追加では同じ回帰を再実行せず[skip ci]とする。

## 未確認・未実装と販売保留
- Sitesの正式DB/R2全量取得・整合点・復旧点・保持/RPO/RTO・独立復元。現toolは本人exportだけで、元user ID/共有/取り込みjob/退会/barrier/thumbnail cacheを復元していない。完全移行不可の項目を空データで埋めない。
- 正式なcontrol-browserスキルは今回も未提供。Sites managed-linux手順の「If it is unavailable, do not improvise another browser-control path.」に従い別手段を代用せず、PC/実タブレット/スマホ、A/Bアカウント試験は未実施。詳細: skill://sites@openai-curated-remote/root/.codex/plugins/cache/openai-curated-remote/sites/0.1.75/skills/sites-building/references/preview/managed-linux.md 。許可専用アカウントも確認できず、既存利用者資料を使っていない。
- 左欄の最後までスクロール、表紙未反映、各検索/共有/書出し/ドラッグ/タッチ/3領域の実画面受入は未実施。v22のCSS配信やローカルhash照合を実機確認/画像不具合解決と記載しない。
- production保存アダプター/OIDC認証移植/Postgres移植、DB分割、世代key/fencing、正式障害終了確認、独立暗号化backup/鍵復旧/自動監視通知到達/退会の最新本人再認証とbackup消去は未実装または未受入。本番では有効化していない。
- 元chatgpt.site URLを外部運用先へ移管する正式権限/手順は未確認。自分のdomainをSitesへ接続するcustom-domain機能と区別し、同じURLの外部移行を約束しない。
- Sites WorkのProcessing/preview404は今回解消したと判断しない。Support再送やMP4提出を必須の次工程にしていない。

## 前回から進んだこと/次の操作
正式復旧の未確認状態を記録した上で、問い合わせ回答に依存しない2案比較・再現費用計算・本人exportの内容照合/表紙復元・安全な独立stage・不足検出を整備した。取得能力/実機受入/運用体制の未確認は解消していない。販売準備完了とは判断しない。
次にユーザーは①PCでv22強制再読込→検索→最後の結果が見えるか、②専用自作PDFの第1page/指定画像表紙→再読込、③folder保存→中断→再開を行い、端末/時刻/操作/結果のみを提出。A/Bと実タブレット/スマホが用意できれば既存チェックリストの残りを続ける。秘密情報やPDFをGitHubへ送らない。環境選定はAを推奨候補として相談できるが、契約/支出/切替は未承認・未実施。詳細と取得scopeはmigration-preparation-v22.mdを参照。
次回の開発はGitHub最新branchと本記録を基準にする。公開Sites sourceは上記v22のままで、offline tools/docsを含むGitHub最新版と区別する。ソース同期時に既存記録を落とさず、app/public/drizzleに予定外差分がないことを確認する。
