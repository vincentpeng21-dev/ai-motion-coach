# AI Motion Coach — 專案筆記

瀏覽器端即時/影片深蹲動作分析 prototype。純前端（HTML/CSS/JS，無 build step、無後端、無付費 API），Pose 偵測與（選配的）AI 講評都在瀏覽器本機執行，影片/攝影機畫面不會上傳到任何伺服器。

這份文件是給「換一台機器繼續開發」時的接續筆記（目前主要在 Windows 上開發，使用者接下來會在 **MacBook Air M2** 上用 Claude Code 繼續），把目前的架構決策、已修過的坑、還沒解決的問題都記下來，避免重新踩一次。

## 跨裝置同步方式

本專案是 **GitHub private repo**（`vincentpeng21-dev/ai-motion-coach`），這是跨 Windows/Mac 的主要同步方式。Google Drive 裡 `G:\我的雲端硬碟\ClaudeCode\projects\AIMotionCoach\` 那份是初期用檔案同步做的一次性快照，**已經被 git 取代，之後不會再更新，不要以那份為準**。

Mac 上接手時：
```bash
gh repo clone vincentpeng21-dev/ai-motion-coach
```
（需要先 `gh auth login` 登入同一個 GitHub 帳號）改完照常 `git add` / `git commit` / `git push`，Windows 這邊再 `git pull` 就好，不會有 Drive 那種檔案衝突副本問題。

## 這個專案在做什麼

- 第一版只支援「側面深蹲」動作分析
- 兩種輸入模式，共用同一套分析管線：
  - 📷 **Webcam 即時分析**（原始版本）
  - 🎬 **影片上傳分析**（後來加的：拖曳/選擇本機影片 → 自動跑完整支影片 → Rep 清單、Timeline、Session Report、Rep-by-Rep 圖表）
- Session Report 額外有一個**選配**的「🤖 AI Coach Commentary」——用 WebLLM 在瀏覽器本機跑一個小型 LLM（Qwen2.5-0.5B），把規則引擎已經算好的數據轉成自然語言講評。**這是全專案唯一用到 LLM 的地方**，而且只吃已經算好的統計數字，不會碰原始影片/landmark，不可能影響 rep 計數或角度數字。

## 架構（重要，改東西前先看這個）

```
Input Layer
 ├── WebcamInput (js/webcamInput.js)   — getUserMedia 生命週期
 └── VideoInput  (js/videoInput.js)    — File → object URL，本機處理不上傳
        ↓
PoseEngine (js/poseEngine.js)          — MediaPipe Tasks Vision PoseLandmarker 包裝
        ↓
MotionAnalyzer (js/motionAnalyzer.js)  — landmark 平滑、選邊、角度計算（唯一一份，兩模式共用）
        ↓
SquatDetector (js/squatDetector.js)    — STANDING→DESCENDING→BOTTOM→ASCENDING 狀態機
        ↓
Results (analysisFrames[] / reps[] / summary)
        ↓
Realtime UI (js/ui.js)  /  Video Report (js/videoReport.js, js/report.js, js/aiCoach.js)
```

**核心原則：Pose Detection / Angle 計算 / 狀態機 / Rep 判定邏輯只有一份**，Webcam 和 Video 兩個模式都呼叫同一個 `PoseEngine` + `MotionAnalyzer` + `SquatDetector` 實例（在 `main.js` 建立），不要為了某個模式另外複製一套邏輯。

`main.js` 負責把兩種模式接起來；`videoAnalysisController.js` 是影片模式專用的「自動跑完整支影片」控制器（用 `requestVideoFrameCallback`，10-15fps 取樣，可調速播放）。

## 檔案總覽

| 檔案 | 內容 |
|---|---|
| `index.html` | 唯一的 HTML，模式選擇畫面 + 主畫面（Webcam/Video 共用同一個 video/canvas 舞台） |
| `css/style.css` | 深色 sports-tech 風格。**注意**：這個檔案裡好幾個元素靠 `hidden` 屬性切換顯示/隱藏，但如果該 class 又自己宣告了 `display:flex/grid`，會蓋掉 `[hidden]` 的 `display:none`，導致元件明明 `hidden=true` 還是擋住點擊——已修過好幾次（`.app-main`、`.upload-zone`、`.controls`、`.rep-log-card`、`.session-report-card`、`.summary-overlay` 都已加 `[hidden]{display:none}` 覆寫）。**之後新增任何用 `hidden` 切換的元件，如果那個 class 有自己的 `display` 宣告，記得同樣加這個覆寫**，不然會重踩一樣的坑。 |
| `js/config.js` | **所有門檻值集中在這裡**（膝角門檻、smoothing、影片分析 FPS、AI Coach 模型 ID…），改參數只改這個檔案 |
| `js/angles.js` | `calculateAngle`、`verticalAngle`、`EMA`（平滑），純函式無 DOM 依賴 |
| `js/poseEngine.js` | `PoseEngine` class（MediaPipe 包裝，GPU delegate 失敗會自動退回 CPU）、`selectSide`、`LandmarkSmoother`、`drawSkeleton`、landmark index 常數 |
| `js/motionAnalyzer.js` | `MotionAnalyzer` class：landmark 平滑 → 選信心較高的一側 → 算 knee/hip/trunk 角度 |
| `js/squatDetector.js` | `SquatDetector`（狀態機）+ `computeSummary()`（Session Summary 統計） |
| `js/webcamInput.js` | `WebcamInput` + `mapCameraError`（getUserMedia 錯誤訊息本地化） |
| `js/videoInput.js` | `VideoInput`（File 驗證 + object URL 載入，含 Chrome webm duration=Infinity 的 workaround） |
| `js/videoAnalysisController.js` | 影片模式「開始分析」的自動化全片播放+取樣控制器 |
| `js/report.js` | 純函式：`buildTimeline`、`drawRepChart`（純 Canvas 畫圖表）、`computeTrackingQuality`、`computeZeroRepDiagnostics`、`renderFilmingTipsHTML`、`formatTime` |
| `js/ui.js` | 共用 DOM 操作（Webcam 模式 + 兩模式共用的指標區塊、模式選擇畫面） |
| `js/videoReport.js` | 影片模式專屬 UI（上傳區、播放控制、Rep 清單、Timeline、Session Report、AI Coach 按鈕綁定） |
| `js/aiCoach.js` | 選配的本機 LLM 講評（WebLLM），下面獨立一節細講 |
| `js/main.js` | 把所有模組接起來的入口，wiring 邏輯 |

## 如何啟動（一定要看，不然會卡住）

**不能直接雙擊 `index.html` 打開！** 專案用 ES module（`<script type="module">`），瀏覽器基於 CORS 政策會擋掉 `file://` 底下載入本機 JS 模組，導致整個 app 完全沒反應（這是使用者第一次遇到的問題，浪費了一輪來回才找到）。

必須用本機靜態伺服器：
```bash
cd <this folder>
npx serve .
```
或用 VS Code 的 **Live Server** 擴充功能（在 `index.html` 右鍵 → Open with Live Server）。開啟後網址列要是 `http://localhost:xxxx/`，不能是區網 IP（WebGPU 需要 secure context，只有 `https://` 或 `localhost` 算數，這點在下面 AI Coach 那節特別重要）。

## AI Coach Commentary（`js/aiCoach.js`）— 目前卡住的地方，重點看這裡

背景：使用者一開始問「Session Report 有沒有用 AI/LLM」，得知是純規則引擎後，主動要求加一個「AI 判斷」層。討論後選了**方案二：瀏覽器本機跑小型 LLM（不用付費 API、不用 server）**，用的是 **WebLLM**（`@mlc-ai/web-llm`），模型是 `Qwen2.5-0.5B-Instruct`（中文能力比 Llama/Phi 系列好，選這個）。

**設計原則（很重要，改這部分邏輯時要守住）**：AI 只能看到規則引擎已經算好的統計數字（`buildSourceData()` / `buildNoRepSourceData()` 組出來的那個物件），**絕對不能碰原始影片或 landmark**，不可能影響 rep 計數或任何角度數字。講評文字旁邊一定要附上「講評依據」（`renderSourceHTML` / `renderNoRepSourceHTML`），把餵給模型的原始數據攤開顯示，讓使用者可以自己核對 AI 沒有捏造數字。

### 已經踩過並修掉的坑

1. **`raw.githubusercontent.com` 被使用者的網路擋掉** → WebLLM 預設把模型的 `model_lib`（WASM 運算函式庫）指到這個網域下載，抓不到直接 fetch failed。**修法**：`getEngine()` 裡動態查 `webllm.prebuiltAppConfig.model_list` 找到對應 model_id 的 entry，把 `model_lib` 網址從 `raw.githubusercontent.com/...` 正則轉成 **jsdelivr 的 GitHub 鏡像** `cdn.jsdelivr.net/gh/.../...`（同樣的檔案，換一個能連到的主機）。這個轉換是通用的（`githubRawToJsdelivr()`），不管換哪個 model_id 都會自動套用。
2. **引擎快取污染**：一開始 `enginePromise` 是模組層級單例，如果建立失敗或後來 WebGPU device 被釋放（"Object has already been disposed"），這個壞掉的 promise 會永遠卡住，之後每次重試都在重用同一個死掉的物件。**修法**：`getEngine()` 建立失敗、或 `runChat()` 執行中偵測到 `dispos|lost|device` 字樣的錯誤，都會呼叫 `resetEngine()` 清空快取，下次點擊會重新建立全新引擎。
3. **f16 量化模型在某些 GPU 上「Unable to find a compatible GPU」** → 一開始用的是 `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`，這個猜測是錯的（見下方「尚未解決」），但已經先把 `CONFIG.aiCoachModelId` 換成 **f32 版本**（`Qwen2.5-0.5B-Instruct-q4f32_1-MLC`，~1GB，broader compatibility），不需要 GPU 的 `shader-f16` feature。這個改動本身沒有壞處（f32 相容性只會更好），先留著。

### 尚未解決 — 換到 Mac 之後第一件事就是驗證這個

即使換成 f32 模型，在測試機（Windows + Intel UHD Graphics 770 內顯）上還是失敗，錯誤訊息：
```
Unable to find a compatible GPU. ...
```
瀏覽器 console 直接顯示的根因是：
```
No available adapters.
```
這是 **`navigator.gpu.requestAdapter()` 在這台機器上直接回傳 null**，跟 `chrome://gpu` 顯示 WebGPU 是 "Hardware accelerated" 互相矛盾（兩者是不同層級的檢查）。已排除的可能性：
- 不是網路問題（已用 jsdelivr 繞過 raw.githubusercontent.com，且這個 adapter 錯誤純粹是本機的，網路根本沒牽涉進來）
- 不是 f16/f32 量化的問題（f32 版本一樣失敗）
- 已確認不是虛擬機（裝置管理員顯示實體的 `Intel(R) UHD Graphics 770`）

還沒試過的（下次接手時的 checklist）：
- 更新 Intel 顯卡驅動（用 Intel Driver & Support Assistant，不要只靠 Windows Update）
- 確認 Chrome 版本（`chrome://version`，需要 113+）
- `chrome://flags/#enable-unsafe-webgpu` 是否為 Enabled
- 換 Edge 測試做對照

**預期 MacBook Air M2 上會直接沒事**：Apple Silicon 的 GPU 在 Chrome/Safari 上都是直接對接 Metal，是 Dawn（WebGPU 底層實作）最成熟穩定的後端之一，比 Intel UHD 內顯走 Windows D3D12 路徑可靠很多。**所以第一件事就是在 M2 上用 Chrome 開這個 App、跑一次「產生 AI 講評」，如果直接成功，這個 issue 就結案，不用回頭修 Windows 那台機器。**

如果 M2 上也失敗，才需要真的認真查（或考慮退回最一開始討論過的方案一：改叫雲端 LLM API，但那個方案需要一個小 server 來保護 API key，且要花錢，跟一開始「不要付費 API / 不要 server」的需求衝突，是最後手段）。

## 測試方式（給 Claude Code 用）

開發過程全程用 **Playwright**（headless Chromium）驗證，不是純用眼睛看：
- 用 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` 兩個 launch flag 模擬攝影機權限，測 Webcam 模式
- 影片模式測試用 Playwright 自己的 `recordVideo` context 功能錄一段 canvas 動畫產生 `.webm` 測試檔（因為沒有真人視訊素材），主要驗證「流程跑不跑得完、console 有沒有 error」，不是驗證姿態辨識準確度（合成影片沒有真人，測不出這個）
- 每次改完都會檢查 `page.on("pageerror")` / `page.on("console")` type=error / `page.on("requestfailed")` 是不是乾淨的
- AI Coach 那段因為需要真實 GPU，沙盒環境測不出完整流程，只驗證到「WebGPU 不支援/引擎失敗時的錯誤處理路徑正確、不會讓整頁掛掉」這個程度——**實際生成講評的效果需要在有真實 GPU 支援的機器上測**（這也是為什麼要換到 M2）

Playwright 全域沒裝在專案裡（這是純靜態專案，沒有 `package.json`/`node_modules`），是另外在系統暫存資料夾裝的，Mac 上要用同樣方式測的話需要另外 `npm install playwright` + `npx playwright install chromium`。

## CONFIG 速查（`js/config.js`）

- `standingAngle` / `descendingAngle` / `bottomAngle` / `goodDepthAngle`：深度判定門檻（膝角，度）
- `stateHoldFrames`：狀態切換需連續幾幀成立（防抖）
- `smoothingFactor`：EMA 平滑係數
- `confidenceThreshold`：landmark 可信度門檻，也用來判斷「有沒有人在畫面裡」
- `videoAnalysisTargetFps` / `videoAnalysisPlaybackRate`：影片自動分析的取樣率跟播放加速
- `filmingTipsQualityThreshold`：追蹤品質低於這個比例，會跳出拍攝建議
- `aiCoachModelId` / `aiCoachCdnUrl`：AI Coach 用的模型跟 CDN 來源

## 待辦 / 已知限制

- [ ] 在 M2 Mac 上驗證 AI Coach Commentary 能不能正常生成（目前 Windows 機器卡在 GPU adapter 問題）
- 真人影片的姿態辨識準確度只在使用者自己的實機測試過幾次（gym 環境、非純側面角度、有鏡子反光跟頭髮甩動，追蹤品質不穩定，已加拍攝建議 UI 提示使用者怎麼拍比較準）
- 沒有自動化測試涵蓋「真人做深蹲」這個情境（合成測試影片沒有真人可用），改動 `squatDetector.js` 邏輯後務必請使用者用真實影片複測

## iOS/Swift 移植計畫（尚未開始，Mac 上要做的下一件大事）

使用者想把這個 prototype 做成 iPhone App，討論過 PWA / Capacitor 包殼 / 原生重寫三個選項，**已定案走原生 Swift**（用 Apple 內建的 Vision framework 做姿態偵測，不是把 MediaPipe 搬過去）。這件事只能在 Mac 上做（需要 Xcode，Windows 沒有工具鏈），這裡先把範圍和技術選型定下來，避免到 Mac 上要重新討論一次。

### 範圍（已確認）
- ✅ Webcam 即時分析
- ✅ 影片上傳分析
- ❌ AI Coach Commentary 先不做，等 Webcam + 影片上傳兩個模式穩定後再加。**已有初步研究結論**（測試機是 iPhone 13）：
  - Apple 官方的 **Apple Intelligence / Foundation Models framework** 用不了——只支援 iPhone 15 Pro 以上（需要 A17 Pro），iPhone 13（A15）不在支援名單內，直接排除
  - 可行方案是比照網頁版 WebLLM 的做法：**自己包一個小型 LLM 進 App**，用 **Core ML** 或 **llama.cpp（走 Metal GPU 加速）**在裝置上跑，不受 Apple Intelligence 硬體限制。設計原則跟網頁版 `aiCoach.js` 一樣：AI 只讀規則引擎算好的統計數字，絕不碰原始影像/關節座標，不影響 rep 計數。代價是 App 體積會變大（模型檔案幾百 MB 到 1GB，跟網頁版下載量級相近），且需要額外工程把模型轉 Core ML 格式或整合 llama.cpp
- 上架 App Store 也先不做，第一階段只求能在使用者自己的 iPhone 上跑（用免費 Apple ID 透過 Xcode 直接裝置安裝即可，不用付 $99/年 Developer Program；缺點是簽章 7 天過期，開發期間常常重新 build 不是問題）

### 技術選型
- **UI**：SwiftUI
- **姿態偵測**：`Vision` framework 的 `VNDetectHumanBodyPoseRequest`（iOS 14+），本機執行、有 Neural Engine 加速，不需要任何外部模型下載。回傳的身體關鍵點包含左右 shoulder/hip/knee/ankle，跟目前 JS 版用的關節對得起來。
  - ⚠️ **座標系統跟 MediaPipe 不一樣**：`VNRecognizedPoint` 是「原點在左下角、Y 軸向上」的正規化座標，MediaPipe landmarks 是「原點在左上角、Y 軸向下」。角度計算/骨架繪製如果直接照搬 JS 版的公式，Y 軸方向會反過來，trunk angle 那類跟垂直方向比較的計算尤其容易出錯——**port 過去時要先確認/測試這個座標轉換，不要當作理所當然**。
  - 每個關節有 `.confidence`（對應 JS 版的 `visibility`）
- **即時攝影機**：`AVFoundation`（`AVCaptureSession` + `AVCaptureVideoDataOutput`），每一幀丟給 Vision 做偵測
- **影片上傳分析**：`PhotosPicker` 或檔案選擇器拿到影片 → `AVAssetReader` 逐幀讀取 → 一樣丟給 Vision，邏輯上對應 JS 版的 `videoAnalysisController.js`

### 架構原則（延續 JS 版，不要重新設計）
沿用同一套分層，Input Layer 換成 Swift 對應物件即可，中間分析邏輯盡量**忠實 port**（尤其 `squatDetector.js` 的狀態機門檻和防抖邏輯已經調過好幾輪、行為已驗證過，直接照搬數字和邏輯，不要憑感覺重寫）：

```
Input Layer
 ├── CameraInput (AVCaptureSession)
 └── VideoFileInput (AVAssetReader)
        ↓
PoseEngine (VNDetectHumanBodyPoseRequest 包裝)
        ↓
MotionAnalyzer (座標轉換 + landmark 平滑 + 角度計算 — 對應 motionAnalyzer.js + angles.js)
        ↓
SquatDetector (狀態機，直接照搬 squatDetector.js 的邏輯與門檻值)
        ↓
Results
        ↓
SwiftUI Views（即時畫面 / 影片分析報告畫面）
```

CONFIG 那些門檻值（`standingAngle`、`descendingAngle`、`bottomAngle`、`stateHoldFrames`…）直接照抄 `js/config.js` 現有數值當起點，不要重新調參。

### 建議專案結構
在同一個 git repo 裡加一個 `ios/AIMotionCoach/` 資料夾放 Xcode 專案，跟網頁版（repo 根目錄）並存，不要開新 repo——這樣共用同一份「已驗證過的邏輯規格」跟 git 歷史，之後兩邊各自演進也還查得到彼此的關聯。

### 在 Mac 上怎麼測（不用等我盲寫完才發現不能編譯）
- `xcodebuild build`（或 `xcodebuild test`）command line 直接編譯，编譯錯誤當場修，不要等使用者手動開 Xcode 才發現
- 影片上傳模式可以在 **iOS Simulator** 測（`xcrun simctl`），不需要實機，因為只是讀影片檔不需要真的攝影機
- Webcam 即時模式一定要**實機測試**（Simulator 沒有真的攝影機），透過 USB 或同 WiFi 無線偵錯裝到使用者的 iPhone 上
