# AI Motion Coach — 專案筆記

瀏覽器端即時/影片深蹲、硬舉動作分析 prototype。純前端（HTML/CSS/JS，無 build step、無後端、無付費 API），Pose 偵測與（選配的）AI 講評都在瀏覽器本機執行，影片/攝影機畫面不會上傳到任何伺服器。

這份文件是給「換一台機器繼續開發」時的接續筆記，把目前的架構決策、已修過的坑、還沒解決的問題都記下來，避免重新踩一次。

## 跨裝置同步方式

本專案是 **GitHub private repo**（`vincentpeng21-dev/ai-motion-coach`），這是跨機器的主要同步方式。

```bash
gh repo clone vincentpeng21-dev/ai-motion-coach
```
（需要先 `gh auth login` 登入同一個 GitHub 帳號）改完照常 `git add` / `git commit` / `git push`，其他機器再 `git pull` 就好。

Google Drive 的 `AI/AIMotionCoach/` 資料夾放的是給 AI 創新服務獎項報名用的作品說明書等文件，裡面的 `index.html`/`css`/`js` 是**手動同步的程式碼快照**（非自動同步），改完 repo 記得視需要手動複製過去更新，不要誤以為那份是即時同步的來源。

## 這個專案在做什麼

- 支援**深蹲（squat）與硬舉（deadlift）**兩種動作分析，畫面左上角可切換
- 兩種輸入模式，共用同一套分析管線：
  - 📷 **Webcam 即時分析**（原始版本）
  - 🎬 **影片上傳分析**（後來加的：拖曳/選擇本機影片 → 自動跑完整支影片 → Rep 清單、Timeline、Session Report、Rep-by-Rep 圖表）
- Session Report 額外有一個**選配**的「🤖 AI Coach Commentary」——用 WebLLM 在瀏覽器本機跑一個小型 LLM（目前是 `Qwen2.5-3B-Instruct`），把規則引擎已經算好的統計數字轉成自然語言講評。**這是全專案唯一用到 LLM 的地方**，而且只吃已經算好的統計數字，不會碰原始影片/landmark，不可能影響 rep 計數或角度數字。
- **訓練歷史紀錄**：本機（localStorage）保存最近 20 筆 Session 的品質分數、統計數字與 AI 講評摘要，Session Report 底部會顯示歷史清單並跟前一筆比較分數趨勢（`js/sessionHistory.js`）。

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
SquatDetector / DeadliftDetector       — STANDING→DESCENDING→BOTTOM→ASCENDING 狀態機
(js/squatDetector.js /                    深蹲用膝角、硬舉用髖角為主要指標，狀態機邏輯共通
 js/deadliftDetector.js)
        ↓
Results (analysisFrames[] / reps[] / summary)
        ↓
Realtime UI (js/ui.js)  /  Video Report (js/videoReport.js, js/report.js, js/aiCoach.js)
        ↓
Session History (js/sessionHistory.js) — localStorage 持久化
```

**核心原則：Pose Detection / Angle 計算 / 狀態機 / Rep 判定邏輯只有一份**，Webcam 和 Video 兩個模式都呼叫同一個 `PoseEngine` + `MotionAnalyzer` + 目前選定的 Detector 實例（在 `main.js` 建立，`setExercise()` 切換 squat/deadlift 時透過 `videoAnalysis.setDetector()` 換掉正在用的偵測器）。

`main.js` 負責把兩種模式接起來；`videoAnalysisController.js` 是影片模式專用的「自動跑完整支影片」控制器（用 `requestVideoFrameCallback`，可調速播放，會針對高解析度影片自動降速避免瀏覽器跳幀，見下方「影片分析穩健度」）。

## 檔案總覽

| 檔案 | 內容 |
|---|---|
| `index.html` | 唯一的 HTML，模式選擇畫面（含動作選擇 pill）+ 主畫面（Webcam/Video 共用同一個 video/canvas 舞台） |
| `css/style.css` | 深色 sports-tech 風格。**注意**：這個檔案裡好幾個元素靠 `hidden` 屬性切換顯示/隱藏，但如果該 class 又自己宣告了 `display:flex/grid`，會蓋掉 `[hidden]` 的 `display:none`，導致元件明明 `hidden=true` 還是擋住點擊——已修過好幾次。**之後新增任何用 `hidden` 切換的元件，如果那個 class 有自己的 `display` 宣告，記得同樣加 `[hidden]{display:none}` 覆寫**，不然會重踩一樣的坑。 |
| `js/config.js` | **所有門檻值集中在這裡**（膝角/髖角門檻、smoothing、防抖秒數、影片分析 FPS、AI Coach 模型 ID…），改參數只改這個檔案 |
| `js/angles.js` | `calculateAngle`、`verticalAngle`、`EMA`（平滑），純函式無 DOM 依賴 |
| `js/poseEngine.js` | `PoseEngine` class（MediaPipe 包裝，GPU delegate 失敗會自動退回 CPU；`detect()` 內建大尺寸影格自動降解析度再推論）、`selectSide`（含逐關節信心度過濾）、`LandmarkSmoother`（低信心關節凍結座標，不隨雜訊漂移）、`drawSkeleton`、landmark index 常數 |
| `js/motionAnalyzer.js` | `MotionAnalyzer` class：landmark 平滑 → 選信心較高的一側 → 算 knee/hip/trunk 角度 |
| `js/squatDetector.js` | `SquatDetector`（深蹲狀態機，時間制防抖＋站姿角度自動校準）+ `computeSummary()` |
| `js/deadliftDetector.js` | `DeadliftDetector`（硬舉狀態機，邏輯跟 SquatDetector 同構，主要指標換成髖角）+ `computeDeadliftSummary()` |
| `js/webcamInput.js` | `WebcamInput` + `mapCameraError`（getUserMedia 錯誤訊息本地化） |
| `js/videoInput.js` | `VideoInput`（File 驗證 + object URL 載入，含 Chrome webm duration=Infinity 的 workaround） |
| `js/videoAnalysisController.js` | 影片模式「開始分析」的自動化全片播放+取樣控制器，含高解析度影片的播放速度自動調節 |
| `js/report.js` | 純函式：`buildTimeline`、`drawRepChart`（純 Canvas 畫圖表，深蹲/硬舉共用不同欄位）、`computeTrackingQuality`、`computeZeroRepDiagnostics`、`renderFilmingTipsHTML`、`formatTime` |
| `js/sessionHistory.js` | `saveSession` / `getSessions` / `updateSessionCommentary` / `clearHistory`，localStorage 持久化最近 20 筆訓練紀錄 |
| `js/ui.js` | 共用 DOM 操作（Webcam 模式 + 兩模式共用的指標區塊、模式選擇畫面、動作選擇） |
| `js/videoReport.js` | 影片模式專屬 UI（上傳區、播放控制、Rep 清單、Timeline、Session Report、歷史紀錄卡片、AI Coach 按鈕綁定） |
| `js/aiCoach.js` | 選配的本機 LLM 講評（WebLLM），下面獨立一節細講 |
| `js/main.js` | 把所有模組接起來的入口，wiring 邏輯，含 `setExercise()` 動作切換 |

## 如何啟動（一定要看，不然會卡住）

**不能直接雙擊 `index.html` 打開！** 專案用 ES module（`<script type="module">`），瀏覽器基於 CORS 政策會擋掉 `file://` 底下載入本機 JS 模組，導致整個 app 完全沒反應。

必須用本機靜態伺服器：
```bash
cd <this folder>
npx serve .
```
或用 VS Code 的 **Live Server** 擴充功能。開啟後網址列要是 `http://localhost:xxxx/`，不能是區網 IP（WebGPU／getUserMedia 都需要 secure context，只有 `https://` 或 `localhost` 算數）。

**部署到正式 Web Server（例如公司內部 IIS）時**：純靜態檔案，直接把 `index.html`/`css`/`js` 放上去即可，不需要額外設定；但**一定要開 HTTPS**，否則瀏覽器會擋掉 `getUserMedia`（Webcam 模式）跟 WebGPU（AI 講評），只剩影片上傳分析還能用。

## 動作選擇（深蹲／硬舉）

模式選擇畫面最上方是動作選擇 pill（🦵 深蹲／💪 硬舉），`main.js` 的 `setExercise()` 負責：
- 切換 `currentExercise`，把 `squat` 這個別名指向 `squatDetector` 或 `deadliftDetector`
- 呼叫 `videoAnalysis.setDetector()` 讓影片分析控制器換用新的偵測器
- 更新畫面上的動作標籤（mode-select 頁面的「目前選擇」文字、主畫面 MODE 標籤）

兩個 Detector 的狀態機（`STANDING→DESCENDING/HINGING→BOTTOM→ASCENDING→STANDING`）邏輯完全同構，唯一差異是深蹲用膝角（`kneeAngle`）、硬舉用髖角（`hipAngle`，shoulder→hip→knee）當主要判定指標，門檻值分別放在 `CONFIG` 頂層跟 `CONFIG.deadlift` 底下。`computeSummary()`/`computeDeadliftSummary()`、`videoReport.js`、`report.js`、`aiCoach.js` 的文案跟計算欄位都已做成依 `exercise` 動態切換，不是寫死深蹲。

新增其他動作類型（例如臥推）時，照抄 `deadliftDetector.js` 的結構最快，記得同時檢查 `SessionSummary`/`AI Coach`/`RepChart` 那幾個依 exercise 分支的地方有沒有漏改。

## 影片分析穩健度——真實影片測試踩過的坑（重要，之後改動作偵測邏輯前一定要看）

這幾個 bug 都是拿使用者實拍的健身房影片（4K 直式手機錄影、有器材遮擋、非標準側面角度）反覆測試才抓出來的，合成測試影片測不出來：

1. **4K 影格降採樣**：手機預設拍 4K，直接把整張影格丟給 MediaPipe 推論太慢，會拖慢 `requestVideoFrameCallback` 的觸發頻率。`poseEngine.js` 的 `detect()` 現在會在畫面最長邊超過 960px 時先縮小再推論。
2. **高解析度影片的自動播放速度**：影片分析預設用 `videoAnalysisPlaybackRate`（4x）加速播放來加快分析，但 4K 影片在 4 倍速下瀏覽器會跳幀，取樣密度可能暴跌到每秒不到 1 張。`videoAnalysisController.js` 現在解析度超過 1920×1080 時直接用原速（1x）分析，並且執行中偵測到跳幀會即時降速。
3. **狀態機防抖改成「真實秒數」而非「影格數」**：`stateHoldFrames`（舊）在 webcam 30fps 下等於合理的 0.17 秒防抖，但影片分析取樣密度低很多（尤其套用上面兩個修正前，可能只有每秒 1-2 張），同樣的影格數門檻換算成真實時間可能長達 10 秒以上，導致一次正常速度的深蹲／硬舉動作永遠無法在防抖時間內完成整個循環，不管深度多標準都判定不到。已改成 `stateHoldSeconds`（真實秒數,目前 0.15 秒),兩種取樣頻率下行為一致。
4. **站姿角度自動校準**：`standingAngle`/`deadlift.standingHipAngle` 假設鏡頭角度/高度會讓「真的站直」量到接近設定值（膝角 165°／髖角 155°）。實測發現不同鏡頭高度可能讓「站直」只量到 130° 左右，導致「回到站姿」（重置動作循環＋完成計數都需要這個條件）永遠無法達成，不管深度多標準都是 0 下。現在每個 Detector 會依「這次訓練實際觀察到的最高角度」動態校準站姿門檻（`standingCalibrationMargin`,目前抓 15°),下限用 `bottomAngle + 15` 卡住不會低到跟底部門檻混在一起。
5. **逐關節信心度過濾**：原本只看肩/髖/膝/踝「平均」信心度，會讓一個被遮擋的關節（例如被槓鈴擋住的腳踝）在其他關節信心度夠高時被平均值蓋過去，用一個不可信的座標算角度。現在改成每個關節都要個別過門檻（`jointMinVisibility`），任一關節信心不足就整體標記不可信；`LandmarkSmoother` 也會把低信心關節的座標凍結在最後一次可信位置，不會被雜訊拉走。

## AI Coach Commentary（`js/aiCoach.js`）

背景：Session Report 原本純粹是規則引擎算出來的數字，後來加了一層選配的「AI 講評」，把統計數字轉成自然語言。用的是 **WebLLM**（`@mlc-ai/web-llm`），在瀏覽器本機以 WebGPU 執行 `Qwen2.5-3B-Instruct`（中文能力夠、體積可接受）。

**設計原則（很重要，改這部分邏輯時要守住）**：AI 只能看到規則引擎已經算好的統計數字（`buildSourceData()` / `buildNoRepSourceData()` 組出來的那個物件），**絕對不能碰原始影片或 landmark**，不可能影響 rep 計數或任何角度數字。講評文字旁邊一定要附上「講評依據」，把餵給模型的原始數據攤開顯示，讓使用者可以自己核對 AI 沒有捏造數字。

### 已經踩過並修掉的坑

1. **`raw.githubusercontent.com` 被使用者的網路擋掉** → WebLLM 預設把模型的 `model_lib`（WASM 運算函式庫）指到這個網域下載，抓不到直接 fetch failed。**修法**：`getEngine()` 裡動態查 `webllm.prebuiltAppConfig.model_list` 找到對應 model_id 的 entry，把 `model_lib` 網址從 `raw.githubusercontent.com/...` 正則轉成 **jsdelivr 的 GitHub 鏡像** `cdn.jsdelivr.net/gh/.../...`。這個轉換是通用的（`githubRawToJsdelivr()`），不管換哪個 model_id 都會自動套用。
2. **引擎快取污染**：`enginePromise` 是模組層級單例，如果建立失敗或後來 WebGPU device 被釋放（"Object has already been disposed"），這個壞掉的 promise 會永遠卡住。**修法**：`getEngine()` 建立失敗、或 `runChat()` 執行中偵測到 `dispos|lost|device` 字樣的錯誤，都會呼叫 `resetEngine()` 清空快取，下次點擊會重新建立全新引擎。
3. **f16 量化模型在某些 GPU 上「Unable to find a compatible GPU」** → 已改用 **f32 版本**（`q4f32_1`），不需要 GPU 的 `shader-f16` feature，相容性更廣，代價是模型檔案較大（~1-2GB）。
4. **Windows + Intel 內顯的 `navigator.gpu.requestAdapter()` 回傳 null** → 換到 Apple Silicon Mac 後**已確認直接正常運作**，Apple Silicon 對 WebGPU/Dawn 的支援比 Windows Intel 內顯完整很多，這個問題已結案，不用再處理。
5. **AI 講評文字跟規則引擎算出的數字矛盾**（例如深度明明已達標，AI 卻建議「蹲更深」）→ 小型 LLM 在比較四個子分數（深度/一致性/節奏/穩定性）找「最弱項」時常常判斷錯誤，直接套用「深蹲要蹲更深」這種訓練資料裡的常見模板。**修法**：改由規則引擎在 JS 端直接算出真正最弱的子項（或判定「四項都很平衡沒有明顯弱點」），明確寫進提示詞逼模型只針對指定分項給建議，不讓模型自己判斷。0 下的情境（`buildNoRepMessages`）也做了同樣的修正——如果觀察到的最低角度其實已經達標，會明確告知模型「深度不是 0 下的原因」，避免生成矛盾的建議。

## 測試方式（給 Claude Code 用）

開發過程用 **Playwright**（headless Chromium/WebKit）驗證流程正確性：
- 用 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` 模擬攝影機權限測 Webcam 模式
- 影片模式可用合成測試影片驗證「流程跑不跑得完、console 有沒有 error」，但**姿態辨識準確度一定要用真實健身房影片測**，合成影片沒有真人測不出這個
- Chromium 不支援 HEVC（iPhone 錄影常見格式），要測真實 iPhone 影片時改用 Playwright 的 `webkit` 瀏覽器（Safari 引擎，macOS 原生支援 HEVC）
- 每次改完都檢查 `page.on("pageerror")` / `page.on("console")` type=error 是不是乾淨的
- **改動 `squatDetector.js`/`deadliftDetector.js` 邏輯後務必請使用者用真實影片複測**——這個專案好幾個重大 bug（防抖時間、站姿角度校準）都是純看程式碼看不出來、非得拿真實影片跑過一次才會發現的

Playwright 沒裝在專案裡（純靜態專案，沒有 `package.json`），要用的話另外在暫存資料夾 `npm install playwright` + `npx playwright install chromium webkit`。

## CONFIG 速查（`js/config.js`）

- `standingAngle` / `descendingAngle` / `bottomAngle` / `goodDepthAngle`：深蹲深度判定門檻（膝角，度）
- `deadlift.standingHipAngle` / `descendingHipAngle` / `bottomHipAngle` / `goodDepthHipAngle`：硬舉對應門檻（髖角，度）
- `standingCalibrationMargin`：站姿角度自動校準的容許誤差（觀察到的最高角度 − 這個值 = 有效站姿門檻）
- `stateHoldSeconds`：狀態切換需持續多少真實秒數才算成立（防抖，兩種取樣頻率下行為一致）
- `smoothingFactor`：EMA 平滑係數
- `confidenceThreshold`：整體（平均）信心度門檻；`jointMinVisibility`：單一關節信心度門檻（兩個都要過）
- `videoAnalysisTargetFps` / `videoAnalysisMinFps` / `videoAnalysisPlaybackRate`：影片自動分析的取樣率、下限、播放加速倍率（高解析度影片會自動降到 1x）
- `filmingTipsQualityThreshold`：追蹤品質低於這個比例，會跳出拍攝建議
- `aiCoachModelId` / `aiCoachCdnUrl`：AI Coach 用的模型跟 CDN 來源

## 待辦 / 已知限制

- [ ] 更多動作類型擴充（臥推、肩推等），照抄 `deadliftDetector.js` 的結構
- [ ] 訓練歷史紀錄目前只有本機 localStorage，沒有跨裝置同步
- 真人影片的姿態辨識準確度仍受拍攝角度、器材遮擋、光線條件影響；已加拍攝建議 UI 提示，但無法完全消除極端拍攝條件下的誤差
- 沒有自動化測試涵蓋「真人做深蹲/硬舉」這個情境（合成測試影片沒有真人可用），改動狀態機邏輯後務必請使用者用真實影片複測

## iOS 原生 App

已經在**獨立的 git repo**（`vincentpeng21-dev/ai-motion-coach-iphone`，本機路徑 `~/ai-motion-coach-iphone/`）用 SwiftUI + Vision framework 完成原生移植，不是這個 repo 的一部分。目前已完成：即時攝影機分析、影片上傳分析、深蹲／硬舉雙模式、Session Report、訓練歷史紀錄、AI 教練講評（Apple Intelligence，不支援的機型自動退回規則式模板）。核心的狀態機門檻、時間制防抖、站姿角度自動校準邏輯都跟這個 repo 保持同步移植。細節、已知限制、下一步規劃請直接看該 repo 裡的筆記/commit history，不在這份文件重複維護，避免兩邊寫的東西不同步。
