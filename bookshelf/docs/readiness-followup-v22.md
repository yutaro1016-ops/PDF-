# version22 利用者受入・再照合・所有Cloudflare準備（2026-10-01 JST）

## 利用者報告の保存
以下はチャットの利用者報告。開発者による実ブラウザー確認と区別する。HTTP状態/試験PDF/OS/Chrome詳細版/表示倍率の証跡は未提出。全資料・全端末を保証しない。
|環境|報告された結果|区分|
|---|---|---|
|Dell PC / Chrome|左欄検索結果の最終行までスクロール、PDF第1page/指定画像の表紙が再読込後も表示、folder保存の中断/再開/完了が可能|利用者確認済み|
|許可された別アカウント|共有PDFの取り込み/閲覧/本文検索が可能、取消後の元リンク/新規取り込み拒否、非共有PDF直接URLから表示されない|利用者確認済み。索引/棚/画像の直接拒否は別途未確認|
|Nothing Phone (2a) / Chrome|PDF閲覧/本文検索/表紙/メニュー/複数選択/移動に問題なし|利用者確認済み|
|タブレット|端末未保有|実機未実施。購入や同じ成功試験を繰返し求めない|

画面幅のレンダリング模擬検証は今回実施していない。指定control-browserが未提供で実端末を操作していない。CSS検査をタブレット実機合格にしない。販売時の対応表では上記PC/Android Chromeで利用者受入がある範囲を記載し、iPad/Safari/タブレットは動作保証対象へ勝手に追加しない。正式な最低版/サポート対象は未決定。

## 個人APIの監査と回帰
currentUserはtrusted Sites user IDとaccount_lifecycleを照合。ownedBookはid AND user_id条件。export-indexは開始時とpullごとに所有確認、export-pagesも所有確認。coverはDBの所有bookからinline画像を返し、thumbnailは所有確認後に本人prefixを取得。shelves GETは本人predicate、PATCH/DELETEも本人predicateと同一origin条件。share preview/importのみ専用の共有権利を扱い、個人APIにtokenによる権利拡張はない。
監査対象に再現する漏えい不備は見つからず、runtimeルートの修正はしていない。tests/sharing_test.mjsへ、匿名401・別owner404・有効share tokenを持っていても個人索引/画像を取得不可・別owner棚変更/削除拒否・棚名不変・本人thumbnail取得成功を追加した。SQLite+模擬R2+合成userの試験であり、実ChatGPTアカウントの代理ログインではない。
最小の残る実機手順: Aの自作PDFを開いた時の /api/library/ID/export-index、/export-pages、/cover?metadata=1、/thumbnail の各URLをBの別profileで開き、データ非表示か確認する。Aの画像と索引が実在するfixtureで、Aは取得可能・Bは拒否を組み合わせる。棚はBの棚一覧にAの棚がないことを確認する。エラー番号と成否のみを報告し、ID/token/実資料をGitHubへ貼らない。棚の破壊試験は今回本番で要求しない。

## 復元後の再照合
`python3 scripts/migration-bundle.py audit /private/export /private/manifest.json /private/existing-stage`
これはSQLite mode=roで比較し、対象stage/原本/報告を変更・削除しない。PDF SHA256、索引number/body/normalized、棚/本のexport列、owner=recovery-staging、inline cover bytes、冊数、余分なPDF/画像、意図しない共有/job/lifecycle/barrier行を検出。元exportはv1、manifestもv1を維持し未対応版は拒否する。restore直後も同じauditを使うので検証の重複実装を避ける。失敗時は既存stageを残し、エラーを調べて新しい独立先に復元する。
manifestは独立したアクセス制限・暗号化領域へ保管。原本と同時改変されたmanifestの真正性を保証しない。署名鍵/署名・暗号化取得・鍵喪失復旧は未実装。scopeはsingle-user-exportでproductionReady=falseを維持。元user ID/共有/job/退会/thumbnail全量/原子的snapshotは不足したまま。

## 容量の読み取り測定
`python3 scripts/staging-capacity.py /private/existing-stage/restored.sqlite`
本人fixture由来のlocal DBをread-only transactionで読み、page_size×page_count、free pages、冊数、宣言PDF容量、索引本文+normalized UTF8 bytesを集計する。ID/本文は出力しない。DB allocationには索引構造/metadataも含む。全件SUMは大きなDBで時間がかかるため本番へそのまま常時実行しない。クラウド請求・本番索引容量・検索速度を実測したという意味ではない。
所有Cloudflareへ移行する場合はD1 dashboard/正式metricsでDB storage・rows read/write・query durationを測る。1DB10GB上限は引上げ不可、8GBを計画上の設計見直し閾値とする（provider上限ではない）。owner→shard台帳を別に置き、所有者を検証してからDBを選ぶ。books/pages/shelves/lifecycle/barrierを同じowner shardへ置き、共有元/先跨ぎjobは再実行可能な順序へ設計する。IDは再生成しない。既存の単一DBコードにroutingがないので分割対応済みとしない。
公式: https://developers.cloudflare.com/d1/platform/limits/ / https://developers.cloudflare.com/d1/observability/metrics-analytics/ （2026-10-01確認）。

## 保存・認証アダプターの境界（設計、未接続）
設定例はexamples/owned-cloudflare-plan.json.example。Wranglerの実deploy設定ではなく、deployAllowed=falseの設計台帳で、資源ID・資格情報を持たない。既存アプリの移行用で別アプリ作成ではない。
- AuthAdapter: 検証済みOIDC issuer/audience/署名/期限/nonceとserver sessionからprincipalを返す。Sitesのoai-authenticated-user-*を外部要求から信用しない。元ユーザーの所有証明と新issuer/subjectの1対1対応を管理者承認してからaccess enabled。email一致や利用者入力のverified=trueを証明にしない。所有証明を正式に得る経路がない現段階では未対応principalは拒否する。
- DatabaseAdapter: owner確認済みcontextからDBを選び、既存prepared SQL/batchを使う。restoreはoffline SQLiteへ限定。本番へ書くimport adapterは未実装。
- ObjectAdapter: HEAD/RangeGET、8MiB multipart、abort/列挙/part照合を区別。既存のoriginalUserId/pdfIdキーを対応表経由で維持し、public bucket/任意key指定を許可しない。FixedLengthStreamのknown-length/実byte長検証を保持。
- OperationCoordinator: 結果不明はbarrierを保持。新設計ではoperation IDと世代keyへ書き、DBの期待世代tokenを満たすcommitだけを表示する。旧workerが旧世代を完成しても最新本体として公開しない。退会tombstoneで新commitを拒否し、削除台帳を別系統保存する。これは提案でruntime未実装、R2一覧/abortだけで旧処理終了が証明されるとしない。
- BackupAdapter: write停止と旧処理終了を証明した窓でDBexportとオブジェクトhash manifestをまとめる。止められなければjournal/immutable世代の追加設計が必要。暗号化・別権限・鍵別保管・完了2世代・失敗/未実行通知・独立restore演習を実装して受入後に運用する。期限案30日と退会消去台帳の保持方針を決定し、restore公開前に最新削除台帳を再適用する。
- ReleaseAdapter: GitHub CI後の承認済みartifactを自分のWorkersへ公開、最小権限API tokenをGitHub secretsへ保持。schemaの後方互換とFixedLengthStreamを保つworker rollback、DB/R2を古い原本へ置換しない復旧を演習する。未承認のtoken発行/サービス契約/自動公開はしていない。
公式: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ （2026-10-01確認）。

## 取得能力と販売条件
本人file/index/metadata/inline coverは既存の所有者APIから取得可能。追加の本人向けexportへ元ID・共有一覧・本人jobの安全なprojection等を拡張する設計は可能だが、取得時点・token秘匿・job復旧・本人認証を受入する必要があり、今回は実装していない。全利用者の認証一覧、R2孤立objects/multipart、全DBの整合snapshot、退会台帳、独立本番復旧は正式権限が未確認。ユーザーexportを全部集めれば完全移行になると断定しない。
前回費用表はmanaged-hosting-comparison.mdを参照。基盤費以外の認証/SMTP、外部通知、別事業者の暗号化backupと転送、決済、税、domain、保守・サポート時間は未計上。これらを0円と扱わず、費用決定前に契約をしない。月500円/年5000円は仮案、利用者1人ではWorkers固定費だけで売上を超え得る。10人でも年額払いの実月売上は約4167円で、認証/人件費等に使える額を別枠で計算する必要がある。売上全額を利益と扱わない。
旧URLの外部移管は正式権限未確認。元Sitesを保持し、新domain/案内/redirectを選ぶ場合も影響・費用・差分保全・切戻しを説明して承認を得る。今回はURL/環境を切り替えていない。
販売保留のP0は正式全量復旧、残る画像/索引/棚の実アカウント分離、必要端末範囲の受入、大容量実端末、本人再認証/退会と復元再公開防止、監視通知/復旧担当と規約。タブレットだけを理由に他準備を止めず、対象端末を限定する選択は可能だが、P0全体が解消したとは判断しない。

## 少人数の価格条件（契約・課金開始なし）
2026-10-01の公式Workers/R2価格を再確認した。前回と同じ平均1GB/人・backup2世代・DB5%・USDJPY150仮定では、Aの1人基盤費は750円/月、10人は797円/月。完全な運用費の最低額は認証/別事業者backup/通知/担当体制未選定のため未確定。
Stripe Japanの標準Paymentsカード成功時3.6%を決済例にすると、1人月500円の受取482円で基盤費だけに対して268円不足する。10人月払いなら受取4820円、基盤費後4023円。10人年額なら年間受取48200円の月換算約4017円、基盤費後約3220円。Stripe Billing/Tax/他支払方法・返金/不審請求等の追加費用、事業税、所得課税、消費税の取扱い、人件費は含まない。3.6%だけで全決済経費としない。売上/受取/利益を分け、無償の保守労働を仮定しない。
保守を仮に月2時間×3000円=6000円（実契約の相場ではなく計画例）と評価すると、10人では基盤+決済だけ黒字でも保守費を賄えない。月500円を維持するなら初期は採算の試験期間として予算を決め、利用者数・問い合わせ頻度・実保存量を測る。契約/決済アカウント/課金設定は作っていない。
公式確認元: https://stripe.com/jp/pricing / https://developers.cloudflare.com/workers/platform/pricing/ / https://developers.cloudflare.com/r2/pricing/ 。
