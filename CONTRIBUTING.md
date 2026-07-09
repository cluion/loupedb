# Contributing to LoupeDB

感謝你的興趣！LoupeDB 歡迎 issue 與 PR。

## 開發環境

- Node.js 24 LTS、pnpm（`corepack enable` 即可）
- Docker（整合測試用 testcontainers 起真實 PostgreSQL）

```bash
pnpm install
pnpm run dev          # http://localhost:3000
```

本地需要 `.env`（見 `.env.example`，`LOUPEDB_MASTER_KEY` 必填）。

## 測試

```bash
pnpm test             # 單元 + 整合（需 Docker）
pnpm run test:e2e     # Playwright E2E（獨立 3200 埠）
pnpm run typecheck
pnpm run lint
```

## PR 準則

- **測試先行**：新功能與修 bug 都需要對應測試；coverage 門檻 80%（CI 會擋）
- **Commit 格式**：conventional commits（`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` / `ci:`）
- 程式碼註解不使用中文全形句逗
- 不可變模式優先，避免 mutate 既有物件
- 檔案小而聚焦（< 400 行）

## 架構速覽

- `server/database/core/` — driver 抽象層與 ConnectionManager
- `server/database/drivers/postgres/` — PostgreSQL driver（MVP 唯一實作）
- `server/api/` — REST endpoints（統一 `Envelope<T>` 回應）
- `app/` — Nuxt 4 前端（components / composables / stores）
- `shared/` — 前後端共享型別（用 `#shared` alias 匯入）

想加第二個資料庫 driver？請先開 issue 討論——driver 介面會在第二個實作進來時一併修正（刻意的設計紀律）。

## 安全

發現安全問題請不要開公開 issue，直接聯絡維護者。
