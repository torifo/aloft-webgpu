[**日本語**](./README.md) ・ [English](./README.en.md)

# WebGPU 名所滑空ツアー(aloft-webgpu)

<!-- tech-stack:start (auto-generated) -->
<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-005A9C?style=for-the-badge&logo=webgpu&logoColor=white" alt="WebGPU">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
</p>
<!-- tech-stack:end -->

**実 DEM（標高データ）**を WebGPU で 3D 地形に描き、世界の名所の上空を雄大に滑空する「ソアリン」的フライト作品。
入口の **Destinations** から行き先を選ぶと滑空が始まる。バックエンドなし・ランタイムはネット非依存（地形は軽量同梱）。

## 収録（5 名所・すべて実 DEM）
ビルド時に AWS Terrain Tiles（terrarium）から取得・標高デコードし、512² の軽量ハイトマップに変換して同梱。

| 名所 | 標高レンジ |
|---|---|
| 富士山 | 15–3732 m |
| グランドキャニオン | 673–2766 m |
| ヒマラヤ（エベレスト周辺） | 2193–8732 m |
| 桂林カルスト | 104–1268 m |
| ノルウェー・フィヨルド | -2–1841 m |

> 取得できない環境では、その地形に寄せた**手続き生成**へ自動フォールバック。

## 飛び方（ハイブリッド）
既定は**オンレールのシネマ滑空**（名所ごとの Catmull-Rom 経路）。**F キー**で**自由滑空**（ハンググライダー操作: W/↑ 上昇・S/↓ 降下）に切替。**Esc** で Destinations に戻る。行き先は URL ハッシュ（`#dest=fuji`）で保持。

## 演出
雲海（眼下の雲層）／ 大気の霞（空気遠近）／ 水面反射（湖・川・フィヨルド）／ 雪冠・標高カラー ／ 速度感（風の筋・FOV・微ブラー）／ 基盤の方向光＝**ゴールデンアワー既定＋時間帯スライダー**。

## スタック
- **描画**: WebGPU（多段パス: 空 → 地形 → 水面 → 雲 → postfx）＋ WGSL
- **ツール**: Node 製の DEM 取得/変換・フォールバック生成（`tools/`）
- **構成**: 素の ES モジュール・依存ゼロ・CDN なし。WebGPU 非対応時はフォールバック表示。

## 動かし方・検証
WebGPU 対応ブラウザで:
```sh
python3 -m http.server 8096   # → http://localhost:8096/
```

```sh
for f in src/shaders/*.wgsl; do naga "$f"; done   # WGSL 検証
for f in src/*.js; do node --check "$f"; done       # JS 構文
node tools/test_dem.mjs && node tools/test_mesh.mjs && \
node tools/test_flight.mjs && node tools/test_fallback.mjs   # 単体テスト（20 件）
```

実 DEM を再取得したい場合:
```sh
node tools/fetch_dem.mjs            # 5 名所を再取得・変換
node tools/fetch_dem.mjs --fallback # 手続き生成で代替
```
> 実際の描画・飛行感は WebGPU ブラウザでの目視確認が前提。
