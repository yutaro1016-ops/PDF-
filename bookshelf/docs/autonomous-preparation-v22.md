# version22 自律整備・運用準備（2026-10-01）

## 範囲
既存アプリの独立移行検証用。公開version22/source 9e7e66478dd21b644944e4867909810da9356fb9を維持。新アプリ・契約・支出・本番切替・通知送信なし。利用者報告はreadiness-followup-v22.mdを継承。タブレット端末未保有のため実機未実施。正式control-browser環境は未提供で模擬画面試験も未実施。成功済みの利用者試験は再要求しない。

## 実装と限界
|変更|実装した範囲|未実装・受入待ち|
|---|---|---|
|migration-bundle audit|読み取りSQLite transactionを使用。件数一致でもID不一致を明示的に拒否。SQL/入力例外のCLI表示改善|PDFファイルの同時変更を完全に固定するsnapshot、画像描画、全文と原PDFの意味的一致|
|legacy restore|未知の本/棚列、未完了PDF、booleanページ番号、既存symlink先を拒否。異常時は今回のstageだけ清掃|推奨入口はseal/verify/restore/audit。旧入口単独はハッシュ原本認証を提供しない|
|migration/access-boundary.mjs|信頼するserver verifier、mapping store、block ledgerを注入。issuer/audience/期限/subject、approved mappingとproof reference、5分以内再認証を要求。所有者prefixの保存キーを限定|JWT/OIDC署名・nonce・session失効・CSRFの実provider接続、対応表1対1制約と所有証明手続き。proof文字列だけでは本人証明にならない。server依存を利用者入力から生成してはいけない|
|migration/generation-model.py|SQLite限定の世代token条件付きcommit。古いtoken/blocked ownerは可視化不可。最新退会台帳の復元除外を冪等適用|実R2 immutable世代object、索引/画像を含む原子的公開commit、全API統合、orphan GC、実worker/下流終了確認。実R2の処理停止・物理消去を保証しない|
|scripts/recovery-gate.py|trusted evidence JSONの厳格なversion/field/type検証、24h経過・未来時刻・hash照合不足・最新台帳不足・対応表不足・結果不明・孤立multipartをblockersとして出力。失敗exit2/入力不正exit1|証跡収集元/署名・全量整合点・自動実行・通知先。すべて合格でもproductionReady=false。時間経過で結果不明を解除しない|
|scripts/manifest-auth.py|独立秘密鍵によるdetached HMAC-SHA256。POSIX鍵権限を検査、タグ既存先を拒否、8MiB逐次処理。署名前の改変は判定不可|暗号化ではない。鍵管理/rotation/復旧/署名前原本の真正性、他系統の独立保管・自動取得は未実装|
|sharing_test|取り込みjob GET/POST/DELETEを他人404・匿名401、他人共有一覧空、拒否応答に元PDF IDなしを追加|実アカウントの直接索引/棚/画像拒否、本番の認証輸送の受入|

実装を現在のSites currentUserへ接続していない。既存のヘッダー認証を外部環境で流用せず、上記境界のserver verifierを正式provider検証へ置換してから使う。objectKeyのcontextも信頼するserver内部だけが作る。入力されたownerIdを直接渡すことは認可ではない。現在のlegacy user ID形式は実取得前に確認し、範囲外IDを勝手に再生成しない。

## ローカル手順
全出力はGitHub外の非公開領域。取得済み本人exportだけを使用する。

1. migration-bundle.py seal EXPORT NEW_MANIFEST
2. manifest-auth.py sign MANIFEST PRIVATE_RANDOM_KEY NEW_TAG
3. 独立保管した鍵・タグで manifest-auth.py verify MANIFEST PRIVATE_RANDOM_KEY TAG
4. migration-bundle.py verify EXPORT MANIFEST
5. migration-bundle.py restore EXPORT MANIFEST NEW_STAGE
6. migration-bundle.py audit EXPORT MANIFEST EXISTING_STAGE
7. staging-capacity.py EXISTING_STAGE/restored.sqlite

各コマンド先頭はpython3 scripts/。秘密鍵は32byte以上の暗号学的乱数を運営者が安全に生成する。試験用固定文字列を実鍵として使わない。原本・manifest/tag・鍵は別権限で保管し、全体は暗号化ディスク/正式な暗号化backup方式へ保存する。鍵とタグと原本が同時に侵害された場合は真正性を保証しない。ツールが暗号化backupを作成したと記載しない。
復元失敗では原本を維持し、新しいstageへ再試行。既存stageのaudit失敗は対象を削除しない。新しい入力形式や未知列は仕様更新と試験を追加してから受入。

recovery-gate入力はformat=pdf-page-finder-recovery-evidence、version=1と、backupCompletedAt（timezone付きISO8601）、hashAudit/deletionLedgerCurrent/ownershipMappingComplete（bool）、unknownStorageOperations/orphanMultipart/restoreExcludedOwners（非負int）のみ。集計だけを通知adapterへ渡す将来設計。ID・本文・token・認証情報は通知に入れない。外部通知実装は未接続、送信はしていない。

## 保存アダプターと復元運用
現在のSQLite stageとファイル保存は既存restoreを再利用。D1 prepare/batchとR2 HEAD/Range/multipartの本番adapterは既存アプリ内にあるが、移行対象bindingの設定/資源作成は承認待ち。設計例owned-cloudflare-plan.json.exampleはdeploy用Wrangler設定ではない。
DB+R2の整合は、承認済み停止窓で全変更入口停止・旧処理/下流終了を正式証明→DB取得→参照object列挙/hash→完了台帳。停止証明が取れなければgeneration/journalを全入口へ統合して受入するまで完全取得としない。Time TravelだけをR2含むsnapshotとしない。
結果不明と孤立multipartはblockerとして維持。列挙/abortは旧worker終了の証明ではない。物理消去の前にvisible commitを拒否し、退会台帳はbackupとは独立保存、復元公開前に最新台帳で除外し索引・棚・画像・共有・ジョブも照合する。modelはこれらの本番実装を代替しない。
日次backup/RPO24h/RTO4h、完了2世代・保持30日、月次独立演習は目標案。費用と消去方針決定前に自動保持/削除を設定しない。秘密鍵喪失、失敗通知、復元所要時間を演習する必要がある。

## 運用チェックリストと通知の境界
|障害|検知/初動|再開条件|
|---|---|---|
|疎通/5xx|health-checkと権限あるログを確認。PDF本文を収集しない|HTTP復帰と対象機能操作を別々に確認|
|backup失敗/未実行|recovery gateに完了時刻・照合結果。古い完成世代を消さない|新領域へのrestore/hash/索引/設定比較成功|
|結果不明/残barrier|対象操作を停止状態で保全。他利用者まで解除しない|正式終了証明と対象object/DB/part照合、承認済み復旧|
|分離の懸念|共有/書出しを含む経路を特定。影響範囲の最小停止案を準備|原因修正、回帰、正式環境で受入|
|容量逼迫|DB allocation、索引容量、R2・operation実測。既存超過を削除しない|DB分割/新規受付抑制等の影響を説明して承認|

日次担当・連絡先・営業時間・代替担当は未決定。実通知サービス・受信設定・到達試験は未実施。閾値の合格を通知到達と混同しない。週次は未完了backup/停止job/権限変更/費用確認、月次は独立復元/鍵復旧/互換rollback、公開前はCI+schema互換+3flagsOFF確認。GitHub CI成功だけでは本番復旧合格ではない。
障害案内の下書き:「現在、一部の保存・閲覧機能を調査しています。登録済み資料の削除や再登録は行わず、復旧をお待ちください。影響範囲と次回の更新時刻は確認でき次第お知らせします。」実際の影響・更新時刻を入れて運営者が送信する。今回送信なし。
問い合わせ受付は版・端末・操作・時刻・伏せたエラーだけを求め、患者情報/PDF/未加工HARを原則受け取らない。機密を含む資料の受領経路/保存期限も要決定。

## 退会・容量管理
本番3flagsOFF。独立fixtureで既存quota予約/確定/取消、長時間書込/lease/二重実行/abort障害をCIで維持。step-upは新auth境界の試験のみで、Sites本人再認証能力は未確認。退会前に対象冊数/画像/索引/棚/共有/ジョブ・書出し機会・コピーが受信者に残る仕様を提示し、明示確認後に削除job、最終照合・再実行・台帳/backup消去期限の案内を行う。本番有効化は全入口のfencingと正式復旧受入後。deletedフラグだけで消去完了通知を出さない。

## 費用・損益の条件
公式Workers最低$5、R2 Standard $0.015/GB月（無料枠/操作課金別）、Stripe標準国内カードPayments 3.6%を2026-10-01再確認。円換算150円/USDは仮定。決済は導入していない。自動定期請求/Billing/Tax等の別製品料金・海外カード・返金・チャージバックは未計上。年額売上は月割し、初月全額を毎月の収入としない。
既存estimateのPDF1/5GB、索引5%、原本+backup2世代、included operation範囲を継承。独立別事業者backup、認証/SMTP、通知、domain、検証資源、税、人件費は別。ゼロ額シナリオは無料確定ではない。

|前提|10人の月額受取/基盤費/残額|10人の年額月換算受取/基盤費/残額|基盤だけの損益分岐|保守2h×3,000円を加えた分岐(月/年)|
|---|---:|---:|---:|---:|
|平均1GB|4,820 / 797 / 4,023円|4,016.67 / 797 / 3,219.67円|2人|15 / 18人|
|上限5GB|4,820 / 1,076 / 3,744円|4,016.67 / 1,076 / 2,940.67円|2人|16 / 19人|

net_estimate/break_evenで再計算可能。保守予算は仮定で実人件費/相場ではない。1人月額は基盤750円に対し受取482円、268円不足。上記分岐にも未確定追加費用・税は含まれず、販売利益保証ではない。50/100人全員5GBではDB5%仮定が単一D1上限を超える既存警告を維持し、その価格で現コード稼働可としない。バックアップ世代/全走査検索/通知・メール頻度が増えると再試算必要。

公式参照:
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://stripe.com/jp/pricing

## 販売文書の必要事項（未公開、適合認定ではない）
利用規約: 学習資料整理用途、配布権、共有/取消と取り込みコピー、禁止データ、容量と大容量/画像PDFの限界、対応端末、障害/責任/契約変更、退会/保持、準拠法・窓口。
プライバシー: 運営者/目的、PDF・索引・画像・認証ID・ログの種類、委託先/国外移転、アクセス制御、保持/消去/backup、本人請求/問い合わせ、侵害時対応。診療情報・患者識別情報・決済カード情報をPDFに保存しない案内。著作権保有/利用許諾がない教科書共有を許可しない。
通信販売表示/最終確認: 運営者情報、税込か否かを含む価格、支払方法/時期、提供開始、無料14日後は自動課金なし、月/年契約期間、更新/解約/返金、利用条件・容量・問い合わせ。仮料金を公開販売表示にしない。年齢/未成年利用・学生への案内は要検討。
消費者庁と個人情報保護委員会の公式資料を参照した必要項目整理であり、法律適合を確認済みとはしない。運営主体・税務・契約条件未定のため専門家確認と確定文面が必要。
- https://www.no-trouble.caa.go.jp/what/mailorder/
- https://www.ppc.go.jp/personalinfo/legal/

## 利用者操作なしで完了/残り
完了: 復元エラー/未知項目保護、独立認証境界、世代commit/退会除外モデル、復旧不足検知、manifest改変検知、job漏えい回帰、費用再計算、運用/販売文書要件。いずれも現在の公開機能や本番全量backupを追加したものではない。
残り: 本番全量取得/整合点/独立復元、正式認証provider/所有者証明/対応表、実R2世代制御/孤立復旧、通知到達、端末・大容量受入、運営担当/税務・契約確定。必要権限・承認を仮定して進めない。
利用者の最小操作は前回の索引/棚/画像の別アカウント拒否のみ（readiness-followup-v22.md）。結果は項目/成功失敗/HTTP状態だけ、私有IDやPDFは提出不要。契約/切替は今回求めない。運営主体/予算/本人認証方式等は選定案と影響を具体化した段階でまとめて承認する。タブレット購入/成功済み試験の再実施は不要。

## 追加: 独立ファイルの暗号化
`node scripts/encrypted-backup.mjs encrypt SOURCE PRIVATE_32_BYTE_KEY NEW_ENCRYPTED_FILE` / `decrypt ENCRYPTED_FILE PRIVATE_32_BYTE_KEY NEW_PLAINTEXT_FILE`。AES-256-GCM、ランダム96bit IV、version付きheaderをAADとして認証、16byte tagを使用。鍵はmanifest HMACと別の32byte乱数、POSIXではowner-only権限。8MiB streamで処理し、復号tag検証完了まで新しい一時ファイルだけに書き、既存destinationを上書きしないhard-linkで確定する。空/8MiB超・誤鍵・破損・短い形式・既存先・失敗時清掃をfixture試験。公開DB/R2に接続しない。
1ファイルはGCM上限64GiB未満（正確には2^36-32byte）まで。多数利用者のarchiveは分割し、順序・全part hashをmanifestで照合する。archive作成や展開は行わず、DB/R2取得の整合点は別途必要。hard-link非対応filesystemは失敗し既存先を維持する。Windows ACLや実利用端末では未受入。強制終了時は0600の一時平文が残り得るので暗号化ディスク上で処理し、専用領域の残存を担当者が確認する。安全な物理消去やpower-loss耐性を保証しない。独立世代保管・鍵保管/復旧・自動backup・監視通知は未稼働。
Node公式暗号APIを参照: https://nodejs.org/api/crypto.html （2026-10-01確認）。manifest-authのHMACは暗号化ではなく、この別toolがファイル暗号化を行う。実利用者backupを今回取得/暗号化したわけではない。
