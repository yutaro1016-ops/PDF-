# PDFファイル配信 GET/HEAD修正候補

base PR #1 headb3414c29b2839bb5d365c70eceee8e102dfa6392、feature/file-range-completion。HEADはRangeを無視しR2 bodyを取得しない。GETは単一byte range/suffix/clamp、safe整数を扱い、不正・複数・範囲外は416を返す。未知unitは全体200。validator未公開のためIf-Range付き要求は全体200へ戻し異なる版の混在を避ける。auth/所有者照合/PUTを保持。

rootがactual routeを変更、final_pdf_securityが別実行で直接diffを読みIf-Rangeを指摘、productionを編集せず3テストを追加。Node24.19.0 stripTypeScriptTypes/VMが実routeを実行し27ケース合格。匿名/他ownerのR2到達拒否、HEADのbody未取得、range metadataとbody、unsafe integer/multi-range、If-Rangeを検証。合成auth/storageのみ、実credential/network0。実route・testsのSHA-256はfile-range-completion-state.json。独立最終判定は限定OFF Draft記録可でdeployment/販売承認ではない。

検証コマンド: `node bookshelf/tests/file_range_test.mjs`。Node24で確認。既存Node22のChecksへ新test実行を自動追加していない。フルNext/TypeScript/Edge build、live R2/health、production/1GB機能全体はこのテストの証明外。RFC根拠 https://www.rfc-editor.org/rfc/rfc9110.html#name-range 。

予算0円と現在無料残量不明のため[skip ci]でDraft保存、Hosted/live healthは起動しない。PR #1へ重ねる修正候補でmain/production変更なし。中央OS Issue #6の独立最終reportと状態を参照 https://github.com/yutaro1016-ops/threads-affiliate-automation/issues/6 。次は正確な無料枠と許可されたintegration環境を確認してからbuild/R2受入、独立reviewと公開条件への承認を得る。
