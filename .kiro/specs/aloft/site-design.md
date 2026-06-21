# aloft — 公開作品化（Soarin'-style Glide Tour）Design

> 現状の「合成fBm島＋自動旋回」MVPを、**実在の名所を滑空する飛行体験ツアー**（ソアリン的）へ拡張する。
> **ローカル動作のみ・デプロイ/publish/commit なし。**

## 1. 体験フロー
- 入口＝**Destinations メニュー**：5名所を黒地・グロー寄りのカードで（starforge の展示室テイストに揃える）。
- 選択 → その地形を**滑空開始**。**ハイブリッド飛行**：
  - 既定＝**オンレールのシネマ・スプライン飛行**（各名所に作り込んだ雄大な飛行経路、ハンズオフ）。
  - 「操縦」キー（例：F）で**自由滑空**に切替（ハンググライダー操作：ピッチ/ヨー/速度）。
- **Esc で Destinations に戻る**。現在地は URL ハッシュ（`#dest=fuji` 等）で保持・リロード復元。
- WebGPU 非対応時：既存フォールバック文言を踏襲。

## 2. 収録（5・全て実DEM名所）
| id | 名称 | 中心座標(約) | 見どころ |
|---|---|---|---|
| fuji | 富士山 | 35.36N, 138.73E | 孤立円錐＋雪冠 |
| grandcanyon | グランドキャニオン | 36.11N, -112.11W | 峡谷の層・川 |
| himalaya | ヒマラヤ/エベレスト | 27.99N, 86.93E | 最高峰・スケール |
| guilin | 桂林カルスト | 25.27N, 110.29E | 林立する塔 |
| fjord | ノルウェー・フィヨルド（ガイランゲル） | 62.10N, 7.21E | 切立つ崖＋水路 |

### データ取得（ビルド時のみ・ランタイムはネット非依存）
- `tools/fetch_dem.mjs`：各名所の bbox を **AWS Terrain Tiles の terrarium PNG**（`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`、z≈10–11）で取得 → タイル結合。
- 標高デコード：`elev_m = (R*256 + G + B/256) - 32768`。
- 軽量化：512²前後のハイトマップ（16bit raw `.bin` か grayscale PNG）に間引き、`assets/<id>.*` として同梱。メタ（標高レンジ・水面高・実距離スケール）を `assets/<id>.json` に。
- **フォールバック**：ネット取得不可時、その地形に寄せた手続き生成（fuji=円錐＋ノイズ、canyon=fBm＋谷の侵食、karst=塔状ノイズ 等）を seeded で生成し同梱。合成「未知の惑星」生成器も汎用フォールバックとして保持。

## 3. 演出署名
- **雲海**：眼下の雲層（手続きノイズの板/ボリューム風）。高度感の要。
- **大気の霞（空気遠近）**：距離フォグ＋空とのブレンド。スケール感。
- **水面**：海/湖/川の高さに反射 plane（フィヨルド・グランドキャニオンの川）。
- **雪冠・標高カラー**：高所=雪、中腹=岩/緑、低地=森の標高ベース配色。
- **速度感**：風の筋・FOV変化・軽いモーションブラー（自由滑空時に強める）。
- **基盤ライティング**：方向光（**ゴールデンアワー既定**）＋**時間帯スライダー**。terrain の陰影/ヒルシェードに必須。

## 4. アーキテクチャ（現MVPからの差分）
- 既存：`src/{main,gpu,dem,mesh,camera}.js` + `src/shaders/terrain.wgsl`。
- 追加：
  - `src/destinations.js` — 名所メタ＋メニューUI＋遷移ルーティング（ハッシュ）。
  - `src/flightpath.js` — オンレール用 Catmull-Rom スプライン経路＋自由滑空モードの切替/操作。
  - `src/sky.js` / `src/clouds.js` — 空・大気・雲海。
  - `src/water.js` — 反射 water plane。
  - `tools/fetch_dem.mjs` + `tools/gen_fallback.mjs` — DEM取得/変換、フォールバック地形生成。
  - 追加WGSL：`sky.wgsl`、`clouds.wgsl`、`water.wgsl`。`terrain.wgsl` を雪冠/標高カラー/距離霞/時間帯光に拡張。
- `renderer`：sky/cloud(遠) → terrain → water → cloud(近)/霞 → postfx(速度ブラー)。

## 5. スコープ
- 今回：5名所（実DEM同梱 or フォールバック）＋ハイブリッド飛行＋6演出＋Escで戻る＋時間帯スライダー。
- 今回外：実天候/季節、地名ラベル、ルート共有/保存、LODタイルストリーミング、建物/都市、植生メッシュ。

## 6. 検証（ローカルのみ）
- 全 `.wgsl` を `naga` 検証。全 `.js` を `node --check`。
- 単体テスト（Node）：terrarium デコード、ハイトマップ→メッシュ生成（頂点/インデックス数・有限値）、飛行スプラインのサンプリング（連続・境界）、フォールバック生成の値域。
- 各パイプラインの bind group ↔ WGSL `@group/@binding` 整合。
- `python3 -m http.server`（空きポート）で 404 無し確認（node fetch）。
- 実描画・飛行感・雲海/水面/霞の見た目は**手動目視**。
- **デプロイ・publish・git commit はしない。**
