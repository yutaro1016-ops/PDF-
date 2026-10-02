# version22 自律整備・検証記録（2026-10-01 JST）

> 2026-10-01 11:42 JST 訂正: 利用者から別アカウントの索引・棚・画像も「問題なし」との報告を受領済みとして扱う。追加の同じ確認依頼は撤回。利用者報告と開発者の独立試験を区別し、HTTP状態・詳細端末版等の未提出を理由に再確認を求めない。以下に残る過去の提出手順は履歴であり、今回の必要作業ではない。
## ソースと本番保全
開始時GitHub e2bb203307e987bd2edd35a3556abd311e35b372と対象branchはidentical。branch feature/digital-bookshelves / PR #1 open Draftを確認。履歴の強制変更なし。
実装・運用準備: 019fb229dfb7328a69ae064ecb16802e264aba40。
独立ファイル暗号化追加: 7c93310180dd84ea95624fc232f2f3a9688e5a39。
公開version22/source 9e7e66478dd21b644944e4867909810da9356fb9を正式get_site/versionで確認。今回保存version/デプロイは実行していない。GitHubは独立準備を含み公開sourceと異なる。
本番環境revision0/entries0を正式APIで確認。CAPACITY_ENFORCED / ACCOUNT_DELETION_ENABLED / STORAGE_OPERATION_GUARD_ENABLEDは既存default false、変更なし。app/public/drizzle/.openaiに今回の差分なし。FixedLengthStream維持。既存PDF/索引/棚/画像に書込・削除・置換なし。

## 変更と解消した事項
詳細はautonomous-preparation-v22.md。
- 既存auditのID欠落例外を明示的な拒否へ変更、SQLite read transaction、未知export envelopeを拒否。
- 旧restore単独でも未知列/未完了PDFを黙って落とさない。既存symlink先とbool pageを拒否。
- server verifier/所有者対応表/退会台帳を注入する独立認証境界。外部Sites header単独を認証としない。正式provider接続は未実装。
- SQLite-onlyの世代token条件付き可視化commit・blocked owner拒否、復元時最新削除台帳の冪等除外モデル。現公開APIへ未接続。
- 復旧証跡の不足/古いbackup/結果不明/孤立partを検出するoffline gate。合格でもproductionReady=false。自動unlock/通知なし。
- 独立鍵でmanifestをHMAC認証。さらにAES-256-GCMで個別ファイルを逐次暗号化/復号。既存先の保護、誤鍵/破損時の未確定平文清掃。全量snapshot/鍵管理運用を実装済みとはしない。
- 他人job GET/POST/DELETEと匿名、共有一覧、拒否エラーのID非露出を回帰追加。
- 決済控除/保守予算付き損益分岐を再計算。運用担当・通知・障害/backup手順、販売文書の必要項目を整理。

## ローカルで確認したこと
- migration_bundle 12試験成功（未知envelope/旧入口/ID改変を追加）。
- backup_restore 1試験、hosting_cost 3試験、recovery_gate 3試験、manifest_auth 2試験成功。
- access_boundary Node試験成功: 無認証/偽header/issuer/audience/subject/期限/未承認mapping/退会/古い再認証/unsafe keyを拒否。
- sharing_test成功。fault injectionの想定Errorログを含むがexit0。実アカウント試験ではない。
- encrypted_backup Node試験成功: 空/31byte/8MiB超、既存先/改変tag/誤鍵/短い形式/不正key権限を拒否、通常例外後temp平文なし。強制killの清掃や実Windows ACLは未検証。
- git diff --check成功。実利用者の秘密/資料を使用せず、合成fixtureのみ。

## GitHub Actions
最初の準備コミット: [Bookshelf checks #134](https://github.com/yutaro1016-ops/PDF-/actions/runs/36804380719)、job110185391988 completed/success。ログの12/2/3/3試験、認証境界、分離、型検査、build、health成功を確認。
最新受入: [Bookshelf checks #136](https://github.com/yutaro1016-ops/PDF-/actions/runs/36804729824)、コミット7c933101、job110186426713 completed/success。暗号化試験、12/2/3/3試験、認証境界、共有/分離、型検査、ビルド、healthが全step成功。ログでも暗号化・破損拒否・既存先保護の成功を確認。記録だけの追記は[skip ci]とし、成功回帰を理由なく再実行しない。

CIの大型試験はローカルSQLite/ディスク/R2 adapter・native workerd・PDF engineの既存回帰。約1GiB、2,000page、画像24pageを本番R2や実ブラウザー成功に転記しない。公開health疎通と実画面機能確認も区別。

## 未確認・未実装と販売保留
正式Sites全量backup/整合点/独立復元/権限は未確認（不存在と断定しない）。ユーザーexportは元owner、共有、job、退会/barrier、thumbnail等が不足し完全移行ではない。今回toolでも不足を埋めていない。
実provider/JWT/session/所有証明、D1分割routing、実R2世代キー/全書込入口のfencing、孤立multipart復旧、独立暗号化保管と鍵復旧/retention/自動取得/通知到達は未実装または未受入。停止や物理消去の証明なしに解除しない。modelで古いcommitを拒否したことを本番復旧完了としない。
現在のURLを外部環境でも維持する正式手順は未確認。契約/支出/切替/問い合わせ送信なし。法的項目は公式資料に基づく整理で、適合認定ではない。料金/税/運営者情報未確定。販売準備完了とは判断しない。
利用者のDell/Nothing Phone/専用別アカウント成功報告は前回記録を維持。直接画像/索引/棚も利用者報告受領済み。開発者自身の実アカウント操作は未実施。タブレットは端末未保有のため実機未実施。成功項目再確認/端末購入は要求していない。
正式ブラウザー制約: sites:sites-building の [managed-linux preview](skill://sites@openai-curated-remote/root/.codex/plugins/cache/openai-curated-remote/sites/0.1.75/skills/sites-building/references/preview/managed-linux.md) は “If it is unavailable, do not improvise another browser-control path.” と指定。control-browser未提供のため別経路を代用せず、画面幅模擬試験も未実施。

## 今回必要な利用者操作
再確認・結果提出は不要。前回の索引/棚/画像への直接アクセス確認依頼を撤回し、利用者報告受領済みとする。契約/有料支出/本番切替等の新しい承認は得ておらず実施しない。将来必要な運用主体/予算/認証方式の意思決定は、具体的な影響を整理した後の別工程。
バックアップ権限が未確認のまま全量復元が可能とは扱わず、同じサポート問い合わせを必須にしない。
