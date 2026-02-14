# G-card-test

ゴジラカードゲーム一人回しツールのテスト版です。

## 今回のリメイク内容
- 既存の見た目・ID・主要挙動を維持したまま、`index.html` から `styles.css` / `app.js` に分離。
- スマホ操作を想定したレスポンシブ調整を追加（画面幅 1024 / 768 / 480px の3段階）。
- React移行の足場として `window.GCardLegacyAPI` を追加（状態スナップショット取得・再描画トリガ）。

## ファイル構成
- `index.html`: マークアップ本体（外部CSS/JSを読み込み）
- `styles.css`: 既存スタイル + モバイル対応
- `app.js`: 既存ロジック（分離） + React移行ブリッジ
- `card_meta.js`: カードメタデータ

## React移行の進め方（段階移行）
1. Reactで「オーバーレイUI」だけ先に置き換える
2. `window.GCardLegacyAPI` で既存状態を参照しつつ並行運用
3. カード描画・ドラッグロジックを機能単位でReact側に順次移管
4. 最終的に legacy API 依存を削除
