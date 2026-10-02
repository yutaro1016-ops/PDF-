# 管理可能な運用環境の比較（2026-10-01）

## 判断
推奨候補はA「自分のCloudflareアカウントでWorkers/D1/R2を管理」。現行のVinext edge API、D1 SQL、R2 multipart/Range、FixedLengthStreamを最も再利用できる。契約・環境作成・切替はしていない。認証置換、正式な原本取得、運用受入が揃うまで移行完了とは判断しない。
B「Workers + Supabase Auth/Postgres + 自分のR2」は、認証とDB運用を製品機能へ寄せる代案。PDF保存はR2に残して1GiB分割保存/Rangeの変更を抑える。SQLiteからPostgresへのSQL・トランザクション移植が必要で、今回は実装していない。
独立した新規アプリの提案ではなく、同じ既存アプリの移行先候補である。

## 比較
|観点|A: Workers/D1/R2 + 標準OIDC認証|B: Workers/Supabase Auth/Postgres/R2|
|---|---|---|
|再利用|HTML/JS、PDF.js、ほぼ全APIとSQLite schema、R2コードを維持。Sites binding注入を自分のWrangler設定へ置換|UI/PDF.js/R2処理は再利用。D1 prepare/batch、json_each、INSERT OR IGNORE、SQLite migration等をPostgresのSQL/transactionへ移植|
|認証|Sitesが注入するoai-authenticated-user-*ヘッダーを直接信用して外部公開してはいけない。OIDCのissuer/audience/signature/nonce、サーバーsession、CSRFを実装・試験。認証製品を選ぶまで費用/完成保証なし|Supabase JWT/sessionを正式に検証。本人step-upを設計。元ChatGPT user IDは移行対応表で保持し、確認済みsubjectと結ぶ。メール一致だけで所有権を移さない|
|分離|全DB入口で所有者predicate、R2は非公開、owner prefix、共有APIのみ権利例外。別アカウントA/Bで実証|同じAPI制約に加えRLS。SELECTの所有条件、UPDATEのUSING/WITH CHECK、索引→本の所有JOIN。service-roleはサーバーのみ、JWT削除だけで全session失効とみなさない|
|登録/閲覧/検索|8MiB multipart、1GiB上限、Range応答、現在の正規化部分一致を維持。1DBは最大10GB、索引実測で超えるならownerごとのDB分割と全APIのroutingが必要|同じR2 multipart/Range。索引本文/normalizedを変えず移す。日本語部分一致を同等に試験し、FTSへ勝手に置換しない。DB容量を増やせるが計算資源・検索性能は別途測定|
|正式DB復旧|自分の権限でD1 export/import、Time Travel（有料30日/無料7日）。Time Travel自体は別DBへのclone/forkを提供しないため独立復元はexport→新DBへimport|ProのDB日次バックアップ7日、CLI db dumpを独立DBへrestore。DBバックアップはStorageオブジェクトを含まない。今回はR2を別途保存|
|DB+PDF/画像の整合点|両案ともDBとR2を跨ぐ原子的snapshotは確認できない。全変更入口の停止・実行中処理の終了確認→DBexportとimmutableオブジェクトの列挙/hash→完了manifest。停止できなければ変更ジャーナル+世代key+再取得の新設計が必要|同左。Postgres transactionだけでR2まで整合すると考えない|
|独立復元|新DB/新bucket・外部アクセスOFF。ID/SHA256/索引内容/設定/画像/権限を照合後に受入|新Postgres/新bucket。auth対応・RLSも独立検証。追加の有料projectは事前承認|
|結果不明・孤立multipart|自分のR2 S3管理権限でListMultipartUploads/ListParts/Abortと完成objectの照合が可能。旧処理終了の証明がないままbarrier解除しない。管理権限があること自体はworker/下流終了の保証ではない|同じR2管理手順。DBだけ強制解除しない。両案とも旧結果が本keyへ再出現しない世代key・commit権限のfencingを設計・異常終了演習してから退会有効化|
|退会/バックアップ|直近再認証、session失効、削除job再実行、multipart/PDF/画像/索引/棚/共有/ジョブ照合。最新tombstoneをバックアップ外の台帳へ保存、restore公開前に再適用。世代消去期限を定める|同左。Supabase auth user削除だけをアプリ/バックアップ削除完了と扱わない|
|監視/公開/復旧|Workers logs/metrics、定期health+未完了backup/残barrier/容量監視、受信者と通知到達を演習。GitHub Actions+最小権限API tokenでWrangler公開、保存した互換worker versionへrollback|同じWorkers公開とR2監視にSupabase DB/Auth監視。schemaの後方互換、二製品の鍵rotation、通知担当が必要|
|保守負担|移植量は少ないが認証・DB分割・バックアップ運用を自分で維持。専任担当と復旧演習が必要|Auth/DB管理を減らせるがSQL移植、RLS、複数製品整合性と固定費が増える|

両案は自作SaaSの運用候補であり、提供元サービス自体の再販売ではない。各契約/AUP、データ処理条件、地域、適用SLAを契約前に確認する。Pro/有料という名称だけでアプリのSLAや医療情報利用を保証しない。今回は学習資料用途で患者情報を扱わない。現Sitesの商用/復旧条件の未確認は解消していない。

## 費用前提と再現
`python3 scripts/hosting-cost-estimate.py`。以下は実請求でなく計画試算。USD/JPY=150は仮定で現在為替ではない。税・決済手数料・開発保守人件費・ドメイン・独立した別事業者のbackup・通知/メール配信・有料OIDC・追加検証project・PITR add-onは除く。共有コピーも受信者保存量に含める。
通常は平均PDF1GB/人、上限ケースは5GB/人。画像等はこの保存量内、DB索引等はPDF量の5%と仮定（実測ではない）。原本+完了済みbackup2世代とDBdump2世代をR2 Standardへ置く: R2GB=PDFGB×3+DBGB×2。
月100回閲覧/人×20 Range要求=2,000 read/人、追加API等込み月1万dynamic要求/人・平均10ms CPU、PDF転送月1GB/人と仮定。DB行read月25B/write50M、R2 A1M/B10M以内の運用を仮定し超過は別課金。日次の全量コピー方式・パート数・共有頻度でA操作が増えるので、運用時には実際に計測する。R2の外向き転送料は無料だが、バックアップ先等の転送/処理費用まで無料という意味ではない。
Workers有料最低$5/月、D1は5GB込み・超過$0.75/GB月。R2 Standardは10GB無料・超過$0.015/GB月、課金GBを切上げる。Bは加えてSupabase Pro $25/月（1project/100k MAU/DB8GB込み、DB超過$0.125/GB）。DBの日次全量dump30回+月1DB分のAPI取得を仮定し、Supabaseからの転送はDBGB×31、250GB超過分$0.09/GBを加える。PDF転送はWorkers/R2へ直接流すためSupabase egressと二重計上しない。Supabase Storageは使わない。AのOIDC認証費用は未確定の別枠であり無料提供を約束しない。

|人数|PDF/人|A概算/月|B概算/月|月額500円の総売上|年額の月換算総売上|
|---|---|---:|---:|---:|---:|
|10|1GB|797円|4,547円|5,000円|4,167円|
|50|1GB|1,076円|4,826円|25,000円|20,833円|
|100|1GB|1,425円|5,175円|50,000円|41,667円|
|10|5GB|1,076円|4,826円|5,000円|4,167円|
|50|5GB|3,315円*|8,162円|25,000円|20,833円|
|100|5GB|6,465円*|15,371円|50,000円|41,667円|

*A上限50/100人は仮定索引が12.5/25GBで単一D1に収まらない。表はDB分割後の保存課金の参考下限であり、現コードのままで稼働できる価格ではない。分割設計・負荷計測が必要。Bも最小computeで必要性能が出る保証ではない。
無料試験枠はAのWorkers 100k request/日・D1 500MB/DBなど、BのFree DB500MB・file1GB・project休止条件があり、バックアップ/商用受入を満たすとみなさない。今回登録やupgradeはしていない。
500円はインフラ費だけならAの10人以上で成立し得る。Bの10人年額払いは基盤費だけで赤字、月払いも残額が少ない。100人でも問い合わせ対応/認証/決済/税等を差し引く前なので利益の保証ではない。長い全量保持、索引readの全走査、重いバックアップCPU、有料認証・PITRにより変わる。
例:100人×5GBで30個の完全backupを常時保持すると、原本500GB+backup15,000GB+DBdump750GBのR2になり、Aは約$263.60/月（39,540円、他費用前）。年額売上月換算41,667円では余裕がほぼなくなる。2世代の安い試算を14日/8週/6月の旧案に適用しない。日次差分・重複排除・削除期限を決めた別試算が必要。

## 公式根拠（確認日2026-10-01）
- Workers料金: https://developers.cloudflare.com/workers/platform/pricing/
- D1料金/上限: https://developers.cloudflare.com/d1/platform/pricing/ / https://developers.cloudflare.com/d1/platform/limits/
- D1 export/import: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- D1復旧/clone制約: https://developers.cloudflare.com/d1/reference/time-travel/
- R2料金/S3列挙中止/整合性/lifecycle: https://developers.cloudflare.com/r2/pricing/ / https://developers.cloudflare.com/r2/api/s3/api/ / https://developers.cloudflare.com/r2/reference/consistency/ / https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- GitHub公開/worker rollback: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ / https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- Supabase料金/DBbackup/RLS: https://supabase.com/pricing / https://supabase.com/docs/guides/platform/backups / https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase changelog: https://supabase.com/changelog （新Data API露出/Node22等の変更あり。比較のみでSDK/schemaの新規導入なし）
- 商用契約の確認元: https://www.cloudflare.com/terms/ / https://supabase.com/terms
- SitesのURL/custom domain: https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites

## 現在の公開URL
公式Sites資料のcustom domainは「所有するdomainをSitesへ接続する」機能である。OpenAIのchatgpt.siteサブドメインを外部環境へ移す正式な手順/権限は確認できない。外部移行して同じURLで全機能を提供できるとは約束しない。旧Sitesをそのまま維持し、新しい所有domainを選ぶ場合の案内/redirectは別途技術確認と利用者承認が必要。今回はURL/DNS/環境を変更していない。
