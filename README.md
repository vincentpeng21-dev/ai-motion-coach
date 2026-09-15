# AI Motion Coach

瀏覽器端深蹲動作分析 prototype（Webcam 即時分析 + 影片上傳分析），純前端、無後端、無付費 API，Pose 偵測與選配的 AI 講評都在瀏覽器本機執行。

這份是 **Mac 快速上手指南**。完整架構、設計決策、已知問題/除錯記錄請看 [CLAUDE.md](./CLAUDE.md)。

## 1. 安裝需要的工具（第一次才需要）

```bash
brew install git node gh
```

## 2. 登入 GitHub（第一次才需要）

```bash
gh auth login
```
選 `GitHub.com` → `HTTPS` → `Login with a web browser`，用跟 Windows 那台同一個帳號（`vincentpeng21-dev`）登入。

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

## 5. 選一個模式開始用

- 📷 **Webcam Live Analysis**：允許攝影機權限 → Open Camera → Start Training
- 🎬 **Video Upload Analysis**：拖曳或選擇 mp4/mov/webm 影片 → Start Analysis

## 6. 第一件要驗證的事：AI Coach 講評

分析出至少 1 下之後，Session Report 底部按「🤖 產生 AI 講評」。

這是目前 Windows 測試機卡住的地方（Intel 內顯回報 `No available adapters`，即使 `chrome://gpu` 顯示 WebGPU 有硬體加速）。**M2 的 GPU 對 WebGPU 的支援通常比 Windows 內顯完整**，預期這裡能直接成功。如果還是失敗，把完整錯誤訊息（連同瀏覽器 DevTools Console 的內容）回報回來，細節見 CLAUDE.md 的「AI Coach Commentary」那節。

## 7. 改完程式碼後怎麼同步回 Windows

```bash
git add -A
git commit -m "說明這次改了什麼"
git push
```
Windows 那邊要拿到更新，跑：
```bash
git pull
```

不要再用 Google Drive 資料夾那份（已經停用），兩台機器都用這個 git repo 互相同步。

## CONFIG 速查

想調整判定門檻（膝角、平滑係數、影片分析 FPS…），改 `js/config.js`，每個參數都有註解。完整清單見 CLAUDE.md。
