# AI Motion Coach

瀏覽器端深蹲／硬舉動作分析 prototype（Webcam 即時分析 + 影片上傳分析），純前端、無後端、無付費 API，Pose 偵測與選配的 AI 講評都在瀏覽器本機執行。

這份是**快速上手指南**。完整架構、設計決策、已知問題/除錯記錄請看 [CLAUDE.md](./CLAUDE.md)。

## 1. 安裝需要的工具（第一次才需要）

```bash
brew install git node gh
```

## 2. 登入 GitHub（第一次才需要）

```bash
gh auth login
```
選 `GitHub.com` → `HTTPS` → `Login with a web browser`，用 `vincentpeng21-dev` 帳號登入。

## 3. Clone 專案

```bash
gh repo clone vincentpeng21-dev/ai-motion-coach
cd ai-motion-coach
```

## 4. 啟動（⚠️ 不能直接雙擊 `index.html`）

專案用 ES module，瀏覽器會擋掉 `file://` 底下載入本機 JS，一定要用本機伺服器：

```bash
npx serve .
```
終端機會印出一個網址（例如 `http://localhost:3000`），用瀏覽器打開它——**建議用 Chrome**。

## 5. 選動作、選模式開始用

- 上方選擇 🦵 深蹲 或 💪 硬舉
- 📷 **Webcam Live Analysis**：允許攝影機權限 → Open Camera → Start Training
- 🎬 **Video Upload Analysis**：拖曳或選擇 mp4/mov/webm 影片 → Start Analysis（建議側面拍攝、避免器材遮擋膝/髖關節，拍攝建議會在畫面上提示）

## 6. AI Coach 講評

分析出至少 1 下之後，Session Report 底部按「🤖 產生 AI 講評」，第一次會下載模型（約 1-2GB，之後瀏覽器會快取）。這功能需要瀏覽器支援 WebGPU（Apple Silicon Mac 上的 Chrome/Edge 正常都可以）；不支援的話會明確告知，不影響核心分析功能。

## 7. 部署到正式 Web Server

純靜態檔案，把 `index.html`/`css`/`js` 複製過去就能跑，不需要 build step。**一定要開 HTTPS**，否則瀏覽器會擋掉攝影機權限（Webcam 模式）跟 WebGPU（AI 講評），只剩影片上傳分析還能用。

## 8. 改完程式碼後怎麼同步

```bash
git add -A
git commit -m "說明這次改了什麼"
git push
```
其他機器要拿到更新，跑：
```bash
git pull
```

Google Drive 資料夾裡的程式碼只是手動同步的快照，不是即時同步來源，改完 repo 記得視需要手動複製更新，不要搞混。

## CONFIG 速查

想調整判定門檻（膝角/髖角、平滑係數、防抖秒數、影片分析 FPS…），改 `js/config.js`，每個參數都有註解。完整清單見 CLAUDE.md。
