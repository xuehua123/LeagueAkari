# League Akari 实时语音 AI 教练：开发交付规格

> 文档状态：可执行开发规格
> 版本：v1.0
> 最后更新：2026-08-25
> 目标：让程序员能够按任务顺序直接开发、联调、测试和验收

## 0. 如何使用本文

五份文档的职责固定如下：

| 文档                                   | 回答的问题                                     |
| -------------------------------------- | ---------------------------------------------- |
| `live-coach-feature-checklist.md`      | 最终要实现哪些功能                             |
| `live-coach-product-feature-list.md`   | 功能属于哪一期、哪个大项目和子项目             |
| `live-coach-three-phase-plan.md`       | 产品原则、技术基线、指标、停止线和总架构       |
| `live-coach-p0-technical-decisions.md` | 已冻结的技术选择                               |
| 本文                                   | 具体创建什么模块、接口、状态、设置、任务和测试 |

冲突优先级：

1. 红线和数据安全边界最高；
2. P0 技术决策高于早期方案中的待选项；
3. 产品功能清单决定范围，不能因为实现困难自行删除功能；
4. 本文决定公开契约和实施顺序；
5. 代码现有公开契约必须兼容，除非有单独迁移 ADR。

开发完成不等于对外开启。所有非红线功能进入开发和内部测试；公开版本仍由 Gate A/B 与细粒度能力开关控制。

## 1. 开工条件

本文发布后，研发可以立即开始。以下外部输入不阻塞编码，但在对应集成测试前必须提供：

- 项目负责人的内部构建环境；
- 一组本人拥有处理权的录像、截图和语音样本；
- OpenAI 或其他 Provider 的内部测试凭据；
- 真实 Windows 10/11 基准机器；
- 外部发布前的审核结论与功能开关配置。

程序员不得等待审核后再写实时功能，也不得在公开构建默认开启未获准能力。

## 2. 目标代码结构

### 2.1 Main Shards

```text
src/main/shards/
  live-game-data/
    index.ts
    context.ts
    state.ts
    live-client-data-loader.ts
    polling-controller.ts
    normalization.ts
    normalization.test.ts

  minimap-observer/
    index.ts
    context.ts
    state.ts
    capture-process-supervisor-controller.ts
    calibration-controller.ts
    observation-controller.ts
    ipc-handlers.ts
    platform.ts

  live-coach/
    index.ts
    context.ts
    state.ts
    session-controller.ts
    capability-controller.ts
    fact-fusion.ts
    rule-engine.ts
    cue-scheduler-controller.ts
    speech-port.ts
    local-speech-executor.ts
    replay-controller.ts
    review-controller.ts
    storage-loader.ts
    storage-executor.ts
    ipc-handlers.ts
    model-orchestration-controller.ts
    model-request-executor.ts
    response-validator.ts
    knowledge-loader.ts

  coach-voice/
    index.ts
    context.ts
    state.ts
    push-to-talk-controller.ts
    audio-device-controller.ts
    local-asr-executor.ts
    provider-controller.ts
    cloud-asr-executor.ts
    cloud-tts-executor.ts
    credential-store.ts

src/main/utility-processes/
  minimap-observer/
    index.ts
    protocol.ts
    capture-controller.ts
    inference-controller.ts
    metrics-controller.ts
  coach-audio/                 # 第三期
    index.ts
    protocol.ts
    microphone-controller.ts
    asr-controller.ts
    speech-controller.ts
```

创建原则：

- `index.ts` 只做 DI、设置注册、propSync、模块构造和生命周期；
- 多个内部模块共享依赖时才创建 `context.ts`；
- 定时器、订阅、队列和状态协调放 controller；
- 单次可失败、可取消操作放 executor；
- 拉取、缓存、归一化放 loader；
- IPC handler 只校验参数并委托；
- 纯映射、schema、规则可以自然命名，不为了形式拆成小文件；
- Windows 副作用在 `platform.ts` 的纯 guard 之后执行；
- 现有旧 Shard 只做必要迁移，保持对外契约。

### 2.2 Shared Types

```text
src/shared/types/live-game-data/
  index.ts
  schemas.ts

src/shared/types/live-coach/
  index.ts
  evidence.ts
  observation.ts
  cue.ts
  review.ts
  voice.ts
  capability.ts
  worker-protocol.ts

src/shared/shards/live-coach/
  settings.ts
  state.ts
  ipc.ts
```

所有跨进程、IPC、持久化 JSON 和模型输出类型必须同时有 TypeScript 类型与 Zod schema。内部纯函数参数不强制重复 schema。

### 2.3 Renderer

```text
src/renderer-shared/shards/live-coach/
  index.ts
  context.ts
  store.ts
  state-sync.ts
  event-handlers.ts

src/renderer/src-main-window/views/live-coach/
  LiveCoach.vue
  Overview.vue
  Calibration.vue
  CoachSettings.vue
  VoiceSettings.vue
  Reviews.vue
  Privacy.vue
  Diagnostics.vue
  components/

src/renderer/src-coach-overlay-window/
  App.vue
  NaiveUIProviderApp.vue
  main.ts
  shards/index.ts
  components/

src/renderer/
  coach-overlay-window.html
```

主窗口路由固定为 `/live-coach/:section?`，section 固定为：

- `overview`；
- `calibration`；
- `coach`；
- `voice`；
- `reviews`；
- `privacy`；
- `diagnostics`。

### 2.4 Native、模型与打包

```text
native/win32-x64/
  src/capture/
  src/speech/
  lib/capture/
  lib/speech/

resources/live-coach/
  runtime/
    onnxruntime.dll
    ffmpeg.exe
  models/
    cv/
    asr/
  manifests/
```

- native workspace 增加 `./capture` 与 `./speech` exports；
- `binding.gyp` 为 capture/speech 创建职责独立的 target；
- utility process 必须作为 electron-vite main 的额外 Rollup input 输出；
- `resources/live-coach/**` 通过现有 `asarUnpack` 进入包外资源；
- 每个 DLL、EXE 和模型都由 manifest 记录版本、SHA-256、许可证和兼容协议版本；
- 缺失、hash 不符或版本不兼容时显示 runtime error 并 fail-closed；
- 云端参考 adapter 使用官方 `openai` Node SDK，并由 `model-request-executor` 统一超时和取消。

## 3. 稳定数据契约

### 3.1 时间和来源

```ts
type CoachTemporalScope = "current" | "recorded" | "historical";

type CoachEvidenceSource =
  | "minimap"
  | "live-client-data"
  | "lcu-gameflow"
  | "lcu-history"
  | "sgp-history"
  | "minimap-replay"
  | "replay-sidecar"
  | "user-input";

interface CoachClock {
  observedAt: number;
  receivedAt: number;
  sequence: number;
}

interface CoachFreshness {
  expiresAt: number;
  state: "fresh" | "stale" | "expired" | "unknown";
}
```

- `observedAt`：源头观察的 Unix epoch ms；
- `receivedAt`：main 接收并验证的 Unix epoch ms；
- TTL 用 main 的单调时钟执行，不依赖系统时钟持续递增；
- 休眠、时钟跳变、worker 重启或跨局时清空 current evidence；
- 当前传感器最大允许偏差 `maxSensorSkewMs` 初始为 750 ms，P0 实测后只能收紧或通过 ADR 调整。

### 3.2 Evidence

```ts
interface CoachEvidence<TPayload> {
  id: string;
  sessionId: string;
  temporalScope: CoachTemporalScope;
  source: CoachEvidenceSource;
  kind: string;
  confidence: number;
  patch: string;
  clock: CoachClock;
  freshness: CoachFreshness;
  payload: TPayload;
}
```

规则：

- ID 在单局内唯一；
- confidence 范围 0–1；
- 当前空间结论的 source 必须包含 `minimap`；
- historical evidence 不得被转换成 current；
- evidence 更新、失效和过期必须传播到 cue；
- renderer 只收到摘要，不收到内部完整图像或模型 tensor。

### 3.3 LiveGameSnapshot

```ts
type LiveGameDomain = "game-stats" | "players" | "events" | "active-player";

interface LiveGameSourceHealth {
  domain: LiveGameDomain;
  state: "idle" | "healthy" | "degraded" | "unavailable";
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
}

interface LiveGameSnapshot {
  sessionId: string;
  patch: string;
  gameTimeSeconds: number | null;
  activePlayer: NormalizedActivePlayer | null;
  players: NormalizedPlayer[];
  events: NormalizedGameEvent[];
  sourceHealth: LiveGameSourceHealth[];
  clock: CoachClock;
}
```

`LiveGameDataMain.subscribe(domain, listener)` 是 main-only typed API：

- 首次订阅立即 replay 当前有效快照或明确的 empty/reset；
- 返回 disposer；
- 跨局先发送 reset；
- listener 异常被隔离并写 warn，不能中断其他订阅者；
- 无 renderer IPC 暴露高频 snapshot。

### 3.4 MinimapObservation

```ts
type ObservationLifecycle =
  "candidate" | "confirmed" | "invalidated" | "expired" | "unknown";

type MinimapEntityKind =
  | "self"
  | "ally"
  | "enemy"
  | "ping"
  | "ward"
  | "minion-wave"
  | "objective-marker";

interface NormalizedMapPoint {
  x: number;
  y: number;
}

interface MinimapEntityObservation {
  trackId: string;
  kind: MinimapEntityKind;
  team: "ally" | "enemy" | "neutral" | "unknown";
  championId: number | null;
  point: NormalizedMapPoint;
  regionId: string | null;
  confidence: number;
  lifecycle: ObservationLifecycle;
  firstObservedAt: number;
  lastObservedAt: number;
  expiresAt: number;
}

interface MinimapObservationBatch {
  sessionId: string;
  patch: string;
  calibrationVersion: string;
  modelVersions: Record<string, string>;
  frame: CoachClock & { ageMs: number };
  health: "healthy" | "degraded" | "unknown";
  entities: MinimapEntityObservation[];
  events: MinimapDerivedEvent[];
}
```

坐标归一化到左上 `(0,0)`、右下 `(1,1)`。地图方向、红蓝方和左右侧由 calibration transform 处理，业务规则不得重复翻转坐标。

### 3.5 Cue

```ts
type CoachCueCategory =
  "information" | "warning" | "opportunity" | "system" | "review";

type CoachCueStatus =
  "pending" | "speaking" | "spoken" | "cancelled" | "expired" | "suppressed";

interface CoachOption {
  id: string;
  label: string;
  condition: string | null;
  evidenceIds: string[];
}

interface CoachCue {
  id: string;
  sessionId: string;
  ruleId: string;
  ruleVersion: string;
  category: CoachCueCategory;
  priority: number;
  observationText: string;
  impactText: string | null;
  options: CoachOption[];
  spokenText: string;
  evidenceIds: string[];
  createdAt: number;
  expiresAt: number;
  status: CoachCueStatus;
  cancellationReason: string | null;
}
```

`options` 最多两个。`spokenText` 由本地安全模板或通过验证的模型结果生成。没有有效 evidence 的 cue 不得进入 pending。

### 3.6 Renderer State

```ts
interface LiveCoachPublicState {
  session: {
    id: string | null;
    state: CoachSessionState;
    mapId: number | null;
    queueId: number | null;
    patch: string | null;
    startedAt: number | null;
  };
  capability: {
    enabledFeatureIds: string[];
    unavailable: Record<string, CoachUnavailableReason>;
  };
  capture: {
    state: string;
    backend: string | null;
    fps: number;
    frameAgeMs: number | null;
    roiState: string;
  };
  liveData: {
    state: string;
    lastSuccessAt: number | null;
  };
  cue: CoachCuePublicDto | null;
  speech: {
    state: "idle" | "speaking" | "muted" | "unavailable";
    cueId: string | null;
  };
  conversation: CoachConversationPublicDto;
  lastError: CoachPublicError | null;
}
```

propSync 只同步 `settings` 与 `state` 两个固定键。高频帧、完整 evidence、录像时间线、云端密钥和音频不进入 propSync。

### 3.7 标定与环境指纹

```ts
interface CaptureEnvironmentFingerprint {
  displayId: string;
  width: number;
  height: number;
  dpiScale: number;
  hdr: boolean;
  windowMode: "windowed" | "borderless" | "exclusive-fullscreen" | "unknown";
  backend: "wgc" | "dda";
  minimapSide: "left" | "right";
}

interface MinimapCalibration {
  schemaVersion: 1;
  id: string;
  fingerprintHash: string;
  roi: { x: number; y: number; width: number; height: number };
  transform: "blue-normal" | "red-rotated";
  source: "automatic" | "manual";
  confidence: number;
  createdAt: number;
}
```

ROI 使用相对窗口内容区的 0–1 坐标。环境指纹任一关键字段变化后，旧标定只能作为候选，必须重新健康检查。

### 3.8 离线录像 Sidecar

```ts
interface CoachReplaySidecarV1 {
  schemaVersion: 1;
  artifactSha256: string;
  patch: string | null;
  mapId: number | null;
  queueId: number | null;
  selfTeam: "blue" | "red" | null;
  videoGameStartMs: number | null;
  roster: Array<{ team: "blue" | "red"; championId: number }> | null;
  events: Array<{
    videoTimeMs: number;
    gameTimeSeconds: number | null;
    kind: string;
    payload: unknown;
  }>;
}
```

sidecar 缺失不阻止纯小地图复盘；依赖 patch、阵容、游戏时间或事件的规则必须逐项关闭。`artifactSha256` 不匹配时拒绝 sidecar。

### 3.9 能力快照

远程资源路径固定为 `live-coach/capabilities`，缓存路径固定为 `config/v1/live-coach/capabilities.json`。

```ts
interface LiveCoachCapabilityEnvelope {
  keyId: string;
  payloadBase64: string;
  signatureBase64: string;
}

interface LiveCoachCapabilityPayload {
  schemaVersion: 1;
  generation: number;
  issuedAt: string;
  expiresAt: string;
  killSwitch: boolean;
  rules: LiveCoachCapabilityRule[];
  models: Record<string, { version: string; sha256: string; url: string }>;
}
```

`AkariApiConfigResourceMap`、schema 和 cached resource 声明同时增加该资源。只有验签后的 payload 能进入 `LiveCoachMain`；原始 envelope 不通过 renderer 同步。

## 4. Worker 协议

### 4.1 Main → Worker

| type              | 必需字段                                              | 结果                 |
| ----------------- | ----------------------------------------------------- | -------------------- |
| `initialize`      | protocolVersion、runtime paths、model manifest        | ready 或 fatal error |
| `start`           | session、HWND/PID、backend、capture config、detectors | 开始采集             |
| `stop`            | sessionId、reason                                     | 清队列并停止         |
| `update-config`   | detector switches、thresholds、FPS                    | 原子切换配置         |
| `request-preview` | requestId、maxEdge、includeImage                      | 一次性预览           |
| `ping`            | requestId、sentAt                                     | heartbeat/pong       |
| `shutdown`        | reason                                                | 释放设备并退出       |

### 4.2 Worker → Main

| type                | 必需字段                                              |
| ------------------- | ----------------------------------------------------- |
| `ready`             | protocolVersion、runtime versions、supported backends |
| `heartbeat`         | sequence、capture state、queue depth、memory          |
| `status`            | backend、resolution、HDR、FPS、ROI health             |
| `observation-batch` | MinimapObservationBatch                               |
| `preview-result`    | requestId、ROI、可选 data URL、expiresAt              |
| `metrics`           | capture/inference/drop/frame-age 分位数               |
| `error`             | code、recoverable、stage、sanitized details           |
| `stopped`           | sessionId、reason                                     |

协议版本不一致直接停止，不做宽松兼容。worker 不允许主动读取 LCU、SGP、SQLite、Provider Key 或 renderer IPC。

## 5. 设置契约

所有用户可见设置属于 `live-coach-main`。默认总开关关闭，但这不代表功能不开发。

| key                          | 类型/默认值                              | 约束                       | 首次阶段 |
| ---------------------------- | ---------------------------------------- | -------------------------- | -------- |
| `enabled`                    | boolean / false                          | 总开关                     | P1       |
| `coachMode`                  | `minimal/balanced/training` / balanced   | 三种固定模式               | P1       |
| `outputMode`                 | `sound/subtitle/speech`[] / 全部         | 至少允许全关               | P1       |
| `captureBackend`             | `auto/wgc/dda` / auto                    | 普通用户默认 auto          | P1       |
| `minimapSide`                | `auto/left/right` / auto                 | 手动选择覆盖自动结果       | P1       |
| `manualCalibration`          | object/null                              | 分辨率、DPI、side 绑定     | P1       |
| `speechEnabled`              | boolean / true                           | 受总开关控制               | P1       |
| `speechVoiceId`              | string/null                              | 仅保存 token ID            | P1       |
| `speechOutputDeviceId`       | string/null                              | null 为系统默认            | P1       |
| `speechVolume`               | number / 0.8                             | 0–1                        | P1       |
| `speechRate`                 | number / 1                               | 0.75–1.5                   | P1       |
| `cueCategories`              | record / 默认全开                        | warning 可单独关闭但需确认 | P1       |
| `pauseShortcut`              | string/null                              | 有状态快捷键               | P1       |
| `muteShortcut`               | string/null                              | 普通切换                   | P1       |
| `overlayShortcut`            | string/null                              | 有状态快捷键               | P1       |
| `recalibrateShortcut`        | string/null                              | 普通触发                   | P1       |
| `pushToTalkShortcut`         | string/null                              | 有状态快捷键               | P3       |
| `overlayEnabled`             | boolean / true                           | 不影响语音后台运行         | P1       |
| `overlayOpacity`             | number / 0.92                            | 0.4–1                      | P1       |
| `replaySpeechSimulation`     | boolean / false                          | 用户主动开启               | P1       |
| `detailedEventRetentionDays` | number / 30                              | 0–365                      | P2       |
| `summaryRetentionDays`       | number / 180                             | 0–3650                     | P2       |
| `cloudMode`                  | `local-only/cloud-enhanced` / local-only | 单独授权                   | P3       |
| `cloudAsrEnabled`            | boolean / false                          | 需要 cloud-asr consent     | P3       |
| `cloudLlmEnabled`            | boolean / false                          | 需要 cloud-ai consent      | P3       |
| `cloudTtsEnabled`            | boolean / false                          | 需要 cloud-tts consent     | P3       |
| `cloudBudgetPerGameCny`      | number / 0.30                            | 0–100                      | P3       |
| `cloudBudgetMonthlyCny`      | number / 20                              | 0–10000                    | P3       |
| `answerLength`               | `short/normal` / short                   | 实时不提供 long            | P3       |
| `language`                   | `zh-CN/en` / zh-CN                       | en 通过评估后启用          | P3       |

以下是硬限制，不做成普通设置：20 秒录音上限、最低 5 FPS、frame age 300 ms、最多两个选项、burst cap、红线和公开 Gate。

## 6. IPC 契约

### 6.1 `minimap-observer-main`

| call                        | 输入                | 输出                            |
| --------------------------- | ------------------- | ------------------------------- |
| `probeSupport`              | 无                  | 平台、后端、HDR、权限与失败原因 |
| `requestCalibrationPreview` | includeImage        | 一次性预览 DTO                  |
| `applyManualCalibration`    | ROI、side、环境指纹 | 校验后的 calibration            |
| `resetCalibration`          | 环境指纹或 all      | 删除数量                        |

### 6.2 `live-coach-main`

| call                          | 输入                                 | 输出                          |
| ----------------------------- | ------------------------------------ | ----------------------------- |
| `startInternalSession`        | 可选 fixture/session config          | 结构化启动结果                |
| `stopSession`                 | reason                               | 结构化停止结果                |
| `pause` / `resume`            | reason                               | 当前状态                      |
| `testSpeech`                  | voice/device/volume/rate             | operation result              |
| `submitCueFeedback`           | cueId、type、可选说明                | feedback ID                   |
| `importReplay`                | file path、可选 sidecar              | import job ID                 |
| `cancelReplayImport`          | job ID                               | cancel result                 |
| `listReplaySessions`          | cursor、limit、filter                | page                          |
| `getReplayTimelinePage`       | sessionId、cursor、limit             | event page                    |
| `getEvidence`                 | evidence ID                          | public evidence DTO           |
| `askText`                     | question、context selector           | conversation result           |
| `beginPushToTalk`             | source                               | conversation ID               |
| `endPushToTalk`               | conversation ID                      | accepted/cancelled            |
| `cancelConversation`          | conversation ID、reason              | result                        |
| `listAudioDevices`            | 无                                   | input/output device DTO       |
| `testMicrophone`              | device ID、seconds≤5                 | level summary，不回传原始音频 |
| `setProviderCredential`       | provider、secret                     | 只返回状态                    |
| `clearProviderCredential`     | provider                             | 删除结果                      |
| `getProviderCredentialStatus` | provider                             | exists/usable，不返回 secret  |
| `listCloudUsage`              | time range、cursor                   | usage page                    |
| `grantConsent`                | consent type、document version       | consent record                |
| `revokeConsent`               | consent type                         | revoke result                 |
| `exportCoachData`             | categories、target path              | export job ID                 |
| `deleteCoachData`             | categories、time range、confirmation | delete job ID                 |

所有 handler 返回真实 controller 结果，让 Akari IPC router 统一包装成功/失败。call 名 camelCase。

### 6.3 Renderer events

只使用 kebab-case：

- `cue-spoken`；
- `cue-cancelled`；
- `replay-import-progress`；
- `data-export-progress`；
- `data-delete-progress`；
- `conversation-partial-transcript`；
- `conversation-final-transcript`；
- `conversation-cancelled`；
- `capability-changed`。

事件必须有 disposer，窗口销毁后不残留 listener。

## 7. 状态机

### 7.1 Coach Session

```text
disabled
  -> idle
  -> awaiting-game
  -> starting
  -> calibrating
  -> shadow
  -> active
  -> paused
  -> degraded
  -> ending
  -> completed
  -> idle
```

| 状态          | 进入条件                          | 允许输出         |
| ------------- | --------------------------------- | ---------------- |
| disabled      | 总开关关闭或平台不支持            | 无               |
| idle          | 已启用但无游戏                    | 系统状态测试     |
| awaiting-game | 等待受支持会话                    | 无               |
| starting      | gameflow + PID/HWND + 2999 初始化 | 无               |
| calibrating   | ROI 未确认或环境变化              | 仅系统提示       |
| shadow        | 采集和分析运行，输出关闭          | 诊断 UI，不播报  |
| active        | 本地健康、授权和输出能力有效      | 正式 cue         |
| paused        | 用户暂停/Alt+Tab 策略/临时降级    | 仅恢复状态       |
| degraded      | 部分数据源或检测器不可用          | 仅剩余已证明能力 |
| ending        | 游戏结束，取消队列并 flush        | 无新实时 cue     |
| completed     | 摘要与复盘已生成                  | 赛后内容         |

错误不自动跳过 calibration。任何 current evidence 在 ending 时全部失效。

### 7.2 Observation

`candidate → confirmed → invalidated/expired`。采集或分类失败进入 `unknown`。unknown 不是低置信 confirmed。

### 7.3 Cue

`pending → speaking → spoken`，或者从 pending/speaking 转 `cancelled/expired/suppressed`。

取消条件：

- evidence 失效；
- 用户静音/暂停；
- 新高优先级 cue 替换；
- 超过 2.5 秒未开始；
- 游戏结束；
- 类别关闭；
- 语音设备失效；
- 问答开始并需要打断当前语音。

### 7.4 Conversation

```text
idle
 -> listening
 -> transcribing
 -> understanding
 -> grounding
 -> generating
 -> validating
 -> speaking
 -> completed

任意非终态 -> cancelling -> cancelled
任意阶段失败 -> local-fallback -> speaking/completed
```

conversation ID 贯穿音频、transcript、模型请求、答案、TTS 和用量；取消后迟到结果必须丢弃。

## 8. 第一期开发任务

任务必须按依赖顺序执行；同一 PR 保持单一主题。

| 任务 ID    | 交付                                  | 依赖     | 完成条件                                   |
| ---------- | ------------------------------------- | -------- | ------------------------------------------ |
| ENG-P1-001 | shared types、schema、固定 ID、错误码 | 无       | 类型测试和 schema round-trip 通过          |
| ENG-P1-002 | `live-game-data-main`                 | 001      | 四个 domain、健康、reset、subscribe 完成   |
| ENG-P1-003 | 复活计时器迁移                        | 002      | 公开 state/settings 不变，停止独立轮询     |
| ENG-P1-004 | CD Timer 迁移                         | 002      | 窗口契约不变，停止独立轮询                 |
| ENG-P1-005 | WGC 原生采集                          | 001      | 1080p/1440p 窗口/无边框有帧和指标          |
| ENG-P1-006 | DDA 备用与 HDR tone-map               | 005      | 后端切换、显示器变化、HDR fixture 通过     |
| ENG-P1-007 | utility process 与 supervisor         | 005      | 心跳、背压、重启、crash-loop、打包通过     |
| ENG-P1-008 | ROI 自动/手动标定                     | 007      | 左右侧、DPI、环境指纹和 unknown 流程完成   |
| ENG-P1-009 | 基础单位检测、追踪、区域              | 008      | 回放指标达到一期门槛                       |
| ENG-P1-010 | `live-coach-main` 会话与 capability   | 002、009 | 状态机、跨局 reset、内部/公开渠道完成      |
| ENG-P1-011 | 事实融合和基础规则                    | 010      | evidence TTL、冲突、确定性回放通过         |
| ENG-P1-012 | cue scheduler                         | 011      | 优先级、冷却、burst、替换、取消通过        |
| ENG-P1-013 | 本地 SAPI TTS                         | 001      | voice/device/rate/volume/cancel 和打包通过 |
| ENG-P1-014 | renderer shard 与主页面               | 010      | settings/state 同步，无原始帧 propSync     |
| ENG-P1-015 | coach overlay window                  | 012、014 | 透明、置顶、点击穿透、快捷键和主题通过     |
| ENG-P1-016 | 首次向导与标定 UX                     | 008、014 | 权限、演示、自动/手动/重置完整             |
| ENG-P1-017 | 离线录像/sidecar 管线                 | 009、011 | 导入、标定、时间映射、取消、时间线通过     |
| ENG-P1-018 | 本局摘要、反馈和导出                  | 012、017 | 结构化摘要、主动导出、错误反馈完成         |
| ENG-P1-019 | 隐私、诊断、能力快照                  | 007、010 | 授权隔离、签名校验、kill switch 完成       |
| ENG-P1-020 | 一期完整验收                          | 全部     | 技术基线第 7.13–7.16 节全部满足            |

第一期不能以“页面能打开”代替真实 Electron、Windows、打包、离线回放和内部真实游戏验证。

## 9. 第二期开发任务

| 任务 ID    | 交付                                 | 依赖               | 完成条件                                    |
| ---------- | ------------------------------------ | ------------------ | ------------------------------------------- |
| ENG-P2-001 | 4K/超宽/HDR/独占全屏/高 DPI 支持矩阵 | P1                 | 每个环境独立标定与准确率报告                |
| ENG-P2-002 | 英雄身份检测                         | P1 detector        | 阵容约束、unknown、混淆矩阵达到门槛         |
| ENG-P2-003 | last-seen 与置信衰减                 | 002                | 只显示最后可见，过期不作当前事实            |
| ENG-P2-004 | 移动趋势、聚集、局部人数             | 002                | track、角度、人数指标达到门槛               |
| ENG-P2-005 | Ping 检测                            | P1 detector        | 独立开关、类别混淆和指标通过                |
| ENG-P2-006 | 兵线/小兵检测                        | P1 detector        | 独立数据集、降级和指标通过                  |
| ENG-P2-007 | 眼位检测                             | P1 detector        | 独立数据集、降级和指标通过                  |
| ENG-P2-008 | 宏观状态机                           | 003–007、live data | 阶段、资源、风险、任务可回放复现            |
| ENG-P2-009 | 候选选项规则库                       | 008                | 每条规则含前置、反例、TTL、取消和证据       |
| ENG-P2-010 | SGP/LCU 历史先验                     | P1、SgpMain        | endpoint 级能力和真实失败分类完成           |
| ENG-P2-011 | 证据面板与态势 overlay               | 008、009           | 来源、时间、置信度、过期和交互完成          |
| ENG-P2-012 | SQLite 会话与迁移                    | P1                 | Entity、升级、保留、导出、删除完成          |
| ENG-P2-013 | 关键时刻复盘                         | 009、012           | 三个关键时刻、当时证据、后续结果完成        |
| ENG-P2-014 | 训练模式与反馈                       | 009、011           | 极简/均衡/训练、反馈和样本授权完成          |
| ENG-P2-015 | 影子评估与补丁门禁                   | 全部               | detector/rule/patch 报告和 fail-closed 完成 |
| ENG-P2-016 | 二期完整验收                         | 全部               | 技术基线第 8.11–8.13 节全部满足             |

SGP 任务不能阻塞不依赖历史先验的实时功能；SGP 失败时必须保持明确降级，不能伪装成 LCU 成功。

## 10. 第三期开发任务

| 任务 ID    | 交付                                     | 依赖       | 完成条件                                 |
| ---------- | ---------------------------------------- | ---------- | ---------------------------------------- |
| ENG-P3-001 | `coach-voice-main` 骨架和 speech adapter | P2         | 单向 DI、取消、设备状态完成              |
| ENG-P3-002 | WASAPI PTT 与 VAD                        | 001        | 按住/切换、20 秒上限、首尾截断指标通过   |
| ENG-P3-003 | 本地 whisper.cpp ASR                     | 002        | 模型校验、partial/final、中文 CER 报告   |
| ENG-P3-004 | 意图与槽位解析                           | 003        | 支持意图 macro-F1 和关键槽位门槛通过     |
| ENG-P3-005 | 对话事实冻结与时效监控                   | P2、004    | 当前/刚才上下文分离，失效可取消          |
| ENG-P3-006 | 本地结构化回答                           | 005        | 所有支持意图在无云端时可回答或正确拒答   |
| ENG-P3-007 | Provider 接口与凭据存储                  | 001        | local/cloud adapter、safeStorage、不泄密 |
| ENG-P3-008 | OpenAI cloud ASR adapter                 | 007        | 上传授权、超时、取消、用量和删除记录     |
| ENG-P3-009 | OpenAI GPT-5.6 Luna Responses adapter    | 005、007   | strict schema、最小上下文、请求审计      |
| ENG-P3-010 | response validator                       | 009        | fact/option 子集、禁词、数字、时效校验   |
| ENG-P3-011 | OpenAI TTS adapter                       | 007        | AI 语音披露、流式首包、SAPI 回退         |
| ENG-P3-012 | 文字/PTT 问答 UI                         | 004–011    | 状态、partial、取消、证据跳转完成        |
| ENG-P3-013 | 个人画像                                 | P2 storage | 可验证事件、置信度、纠正、清空完成       |
| ENG-P3-014 | 多局训练计划                             | 013        | 目标、代理指标、复盘和中途调整完成       |
| ENG-P3-015 | 长期报告                                 | 013、014   | 趋势、样本量、补丁分段和导出完成         |
| ENG-P3-016 | 云端用量、BYOK 和预算                    | 007–011    | 单局/月预算、熔断、本地回退、历史记录    |
| ENG-P3-017 | 授权中心与云端删除                       | 007、016   | 分项授权、撤回、导出、删除 E2E 通过      |
| ENG-P3-018 | AI/ASR 安全评估                          | 004、010   | 注入、恶意 ASR、无依据事实和拒答指标通过 |
| ENG-P3-019 | 三期完整验收                             | 全部       | 技术基线第 9.14–9.16 节全部满足          |

OpenAI 参考 adapter 的实现依据官方文档；模型 ID、价格和地区可用性必须在集成测试时重新确认，并通过配置更新，不写死为永久产品事实。

## 11. UI 与交互规格

### 11.1 主页面

#### Overview

- 总开关；
- 当前状态与明确原因；
- 当前地区、地图、队列、补丁和 build channel；
- Gate A/B 只读状态；
- 捕获、标定、Live Data、语音和云端状态；
- 最近一条提示；
- 开始演示、内部手动启动、暂停、停止；
- 第一次进入显示完整引导。

#### Calibration

- 自动检测小地图左右侧和 ROI；
- 显示环境指纹；
- 一次性 ROI 预览；
- 拖拽框选；
- 应用、重置、重新检测；
- 正常、降级、未知、不支持四种状态；
- 黑帧、遮挡、DPI、分辨率变化的说明；
- 不持续显示实时游戏画面。

#### Coach

- 极简、均衡、训练模式；
- 信息、危险、事件、机会、系统类别开关；
- 字幕、提示音、语音开关；
- 提示密度只允许在硬上限内调整；
- overlay 开关、透明度和快捷键；
- 当前规则/模型版本和补丁支持。

#### Voice

- 输入/输出设备；
- 麦克风电平测试；
- 本地 voice、音量、语速测试；
- PTT 快捷键和模式；
- 本地/云端能力差异；
- Provider 凭据状态，只能替换或删除；
- AI 语音披露；
- 单局/月预算和本局用量。

#### Reviews

- 会话列表、筛选和保留期；
- 三个关键时刻摘要；
- 时间线和 evidence 跳转；
- 播放录像或模拟语音；
- 文字/语音提问；
- 有用、错误、太晚、太频繁反馈；
- 导出与删除。

#### Privacy

- 分项授权：麦克风、云端 ASR、云端 AI、云端 TTS、画像、云同步、样本改进、诊断；
- 每项显示目的、字段、位置、期限、供应商和撤回效果；
- 查看授权版本；
- 导出全部数据；
- 删除本地/云端数据及进度；
- 默认不勾选任何云端或样本上传授权。

#### Diagnostics

- 支持矩阵；
- capture backend、FPS、frame age、drop、queue depth；
- ROI health、detector versions、补丁；
- 2999 domain health；
- utility process 心跳/重启；
- TTS/麦克风/Provider 状态；
- 最近错误码与可操作解决办法；
- 生成脱敏诊断包前预览包含内容。

### 11.2 Overlay

窗口初始内容尺寸固定为 420×168，最小内容尺寸为 320×80；`frame=false`、`transparent=true`、`resizable=false`、`skipTaskbar=true`、always-on-top。默认 `focusable=false` 且点击穿透；进入明确的快捷键交互态时临时设为 focusable 并取消点击穿透，退出后立即恢复且把焦点还给游戏。

overlay 有四种密度：

1. 状态点：只显示运行/降级/暂停；
2. 字幕条：观察和短提示；
3. 证据卡：观察、时间、来源、置信度；
4. 问答态：录音、识别、生成、播放、取消。

规则：

- 默认点击穿透；
- 状态变化使用短动画，不闪烁；
- 正式提示与系统错误视觉区分；
- 证据过期后变灰或移除；
- 麦克风采集状态持续可见；
- 团战高负荷时自动收缩为最小密度；
- 不遮挡小地图、技能栏和聊天区域；
- 位置按显示器和分辨率持久化；
- 游戏结束后转为简短赛后入口或隐藏。

### 11.3 Renderer 实现规范

- 同类设置沿用 `SettingsSection`、`SettingsRow` 与现代生产组件；
- 交互控件使用 Naive UI；
- 所有句子进入 i18n YAML；
- 含组件插值的翻译使用 `TranslationComponent`；
- 多个独立数量拆分 plural key；
- Tailwind 使用 v4 语法；
- SFC style 中使用 `@apply` 时先 `@reference`；
- dark mode 使用 `data-theme="dark"`，不得新增 `.dark`；
- native button/input 不得依赖浏览器默认样式；
- overlay 的 VNode-heavy 通知或弹窗使用 `.tsx`。

## 12. 错误与降级

公开错误码固定为：

- `unsupported-platform`；
- `unsupported-map`；
- `unsupported-queue`；
- `unsupported-patch`；
- `capability-disabled`；
- `consent-required`；
- `capture-target-not-found`；
- `capture-permission-denied`；
- `capture-black-frame`；
- `capture-stalled`；
- `capture-crash-loop`；
- `calibration-required`；
- `roi-occluded`；
- `cv-overloaded`；
- `live-data-unavailable`；
- `speech-unavailable`；
- `microphone-unavailable`；
- `asr-low-confidence`；
- `provider-credential-missing`；
- `provider-timeout`；
- `provider-rate-limited`；
- `provider-region-unavailable`；
- `budget-exhausted`；
- `response-rejected`；
- `storage-unavailable`；
- `internal-error`。

错误 DTO 只含 code、stage、recoverable、发生时间和脱敏 details。底层堆栈只进本地日志，不进入普通 UI 或远程上传。

降级顺序：

1. 云端 TTS → 本地 SAPI；
2. 云端 LLM → 本地结构化模板；
3. 云端 ASR → 本地 ASR；
4. 英雄身份 → 敌方/友方单位；
5. 高级检测器 → 基础可见单位；
6. WGC → DDA；
7. 实时输出 → shadow；
8. 实时采集失效 → 离线复盘入口；
9. 红线风险或安全事件 → 立即停止相关能力，不使用替代绕过。

## 13. SQLite 结构

### 13.1 CoachSessions

| 字段              | 类型                   | 说明                         |
| ----------------- | ---------------------- | ---------------------------- |
| id                | varchar PK             | UUID                         |
| gameId            | varchar nullable/index | 不使用 JS number             |
| selfPuuidHash     | varchar nullable/index | 默认哈希                     |
| region            | varchar/index          | 登录区服                     |
| rsoPlatformId     | varchar                | 平台                         |
| mapId             | integer                | 地图                         |
| queueId           | integer nullable       | 队列                         |
| patch             | varchar/index          | 补丁                         |
| startedAt/endedAt | datetime/index         | 会话范围                     |
| mode              | varchar                | 教练模式                     |
| result            | varchar                | completed/aborted/error      |
| configJson        | text                   | schema-versioned             |
| versionsJson      | text                   | capture/model/rule/knowledge |
| summaryJson       | text nullable          | 结构化摘要                   |

### 13.2 CoachEvents

| 字段          | 类型          |
| ------------- | ------------- |
| id            | varchar PK    |
| sessionId     | varchar/index |
| occurredAtMs  | integer/index |
| kind          | varchar/index |
| category      | varchar/index |
| status        | varchar       |
| confidence    | real nullable |
| payloadJson   | text          |
| evidenceJson  | text          |
| schemaVersion | integer       |

### 13.3 其他表

- `CoachFeedbacks`：sessionId、cueId、type、note、createdAt、sampleContributionId；
- `CoachTrainingPlans`：id、period、goal、metric、baseline、status、createdAt、updatedAt；
- `CoachCloudUsages`：provider、model、operation、units、estimatedCny、requestIdHash、createdAt；BYOK secret 永不入库；
- `CoachConsents`：type、documentVersion、grantedAt、revokedAt、scopeJson；
- 所有外键和删除策略在迁移中显式创建；
- 删除 session 时级联结构化 events/feedback/usage，不删除用户明确独立保存的训练计划；
- 详细 events 和摘要使用不同保留任务。

## 14. 产品功能覆盖矩阵

### 14.1 第一期

| 产品大项目                  | 主工程任务           |
| --------------------------- | -------------------- |
| P1-M01 产品入口与首次启用   | ENG-P1-014、016、019 |
| P1-M02 教练会话管理         | ENG-P1-010           |
| P1-M03 小地图设置与标定     | ENG-P1-008、016      |
| P1-M04 基础小地图观察       | ENG-P1-009、011      |
| P1-M05 基础教练提醒         | ENG-P1-011、012      |
| P1-M06 语音、提示音与字幕   | ENG-P1-013、015      |
| P1-M07 教练悬浮窗           | ENG-P1-015           |
| P1-M08 教练模式与功能设置   | ENG-P1-010、014、019 |
| P1-M09 离线录像分析         | ENG-P1-017           |
| P1-M10 本局摘要与基础复盘   | ENG-P1-018           |
| P1-M11 隐私与数据控制       | ENG-P1-018、019      |
| P1-M12 诊断、帮助与产品运营 | ENG-P1-016、019、020 |

### 14.2 第二期

| 产品大项目                  | 主工程任务           |
| --------------------------- | -------------------- |
| P2-M01 支持环境扩展         | ENG-P2-001           |
| P2-M02 高级小地图态势识别   | ENG-P2-002–007       |
| P2-M03 赛前计划与开局目标   | ENG-P2-008–010       |
| P2-M04 对局阶段与当前任务   | ENG-P2-008、009      |
| P2-M05 目标资源准备教练     | ENG-P2-008、009      |
| P2-M06 地图风险与人数教练   | ENG-P2-003、004、009 |
| P2-M07 击杀、死亡与转换窗口 | ENG-P2-008、009      |
| P2-M08 证据面板             | ENG-P2-011           |
| P2-M09 态势悬浮窗           | ENG-P2-011           |
| P2-M10 教练模式与个性化设置 | ENG-P2-009、014      |
| P2-M11 局内反馈             | ENG-P2-014           |
| P2-M12 赛后关键时刻复盘     | ENG-P2-012、013      |
| P2-M13 离线态势复盘增强     | ENG-P2-008、009、013 |
| P2-M14 产品质量与运营反馈   | ENG-P2-015、016      |

### 14.3 第三期

| 产品大项目                | 主工程任务           |
| ------------------------- | -------------------- |
| P3-M01 离线赛后证据问答   | ENG-P3-005、006、012 |
| P3-M02 按键说话           | ENG-P3-001–003       |
| P3-M03 实时语音与文字问答 | ENG-P3-004–012       |
| P3-M04 对话交互体验       | ENG-P3-005、012      |
| P3-M05 回答证据与可信体验 | ENG-P3-005、009、010 |
| P3-M06 游戏知识与解释     | ENG-P3-006、009、010 |
| P3-M07 个人教练画像       | ENG-P3-013           |
| P3-M08 多局训练计划       | ENG-P3-014           |
| P3-M09 长期进步报告       | ENG-P3-015           |
| P3-M10 个性化语音体验     | ENG-P3-001、011、012 |
| P3-M11 本地与云端服务选择 | ENG-P3-006–011、016  |
| P3-M12 隐私与授权中心     | ENG-P3-007、017      |
| P3-M13 回答反馈与纠错     | ENG-P3-010、012、018 |
| P3-M14 服务状态与降级体验 | ENG-P3-006–012、016  |

所有 40 个产品大项目都有工程归属。具体子功能以产品功能清单为验收输入，不能只完成表中部分文件就勾选大项目。

## 15. 测试资产和测试方法

### 15.1 测试目录

```text
src/shared/test-fixtures/live-coach/
  live-client-data/
  worker-protocol/
  rules/
  model-responses/

test-assets/live-coach/
  replay-manifests/
  synthetic-roi/
  audio/

<external controlled dataset>/
  real-roi/
  annotated-clips/
  performance-captures/
```

真实用户样本不进入 Git。仓库夹具必须确认无账号、聊天、桌面和其他窗口内容。

### 15.2 必测层级

- 单元：归一化、TTL、差分、规则、优先级、取消、schema、预算；
- 契约：LCU、2999、SGP、worker protocol、IPC DTO、Provider、SQLite migration；
- 回放：固定输入得到固定 observation/cue/cancel；
- 组件：设置、状态、错误、证据、授权和问答交互；
- Electron E2E：窗口、路由、快捷键、点击穿透、设备断开；
- Windows 实机：WGC、DDA、HDR、独占全屏、DPI、多屏、休眠恢复；
- 打包 smoke：native addon、utility entry、DLL、模型、资源路径；
- 性能：CPU/GPU/内存/VRAM/FPS/frame age/音频延迟；
- soak：100 小时采集、跨局、重连和资源泄漏；
- 安全：恶意 worker message、模型输出、提示注入、密钥与日志泄漏；
- 隐私：未授权零采集/零上传、撤回、导出、删除；
- 统计：按技术基线第 11 节分层和置信区间验收。

测试不读取源码字符串断言文件名、CSS 类或实现细节。Electron、原生模块、打包和视觉行为必须在对应真实运行时验证。

### 15.3 每个任务的 Done

每个 ENG 任务只有同时满足以下条件才完成：

- 功能路径实现；
- 失败、取消、重试和清理实现；
- 公开状态可诊断；
- 设置、IPC 和持久化有 schema；
- 关键用户行为或协议有相称测试；
- i18n 中英文键完整；
- 修改文件完成 Prettier；
- `yarn typecheck:node` 与/或 `yarn typecheck:web` 通过；
- 相关 Vitest 通过；
- 涉及窗口/原生/打包时完成对应 smoke；
- 没有把红线、密钥、原始画面或高频帧引入错误边界；
- 更新产品大项目覆盖状态和验收证据链接。

## 16. 推荐 PR 顺序

单人开发按以下顺序推进，可以避免大面积返工：

1. `feat(live-coach): add shared contracts and feature ids`；
2. `feat(live-game-data): add normalized live client polling`；
3. `refactor(respawn-timer): consume unified live game data`；
4. `refactor(cd-timer): consume unified live game data`；
5. `feat(minimap-observer): add utility process protocol and supervisor`；
6. `feat(native-capture): add WGC capture and metrics`；
7. `feat(native-capture): add DDA and HDR fallback`；
8. `feat(minimap-observer): add calibration and replay harness`；
9. `feat(minimap-observer): add basic detectors and tracking`；
10. `feat(live-coach): add session, evidence and rules`；
11. `feat(live-coach): add cue scheduler and local speech`；
12. `feat(coach-overlay): add dedicated overlay window`；
13. `feat(live-coach-ui): add onboarding, settings and diagnostics`；
14. `feat(coach-replay): add offline import and review`；
15. 完成一期指标后进入二期检测器、状态机和存储；
16. 完成二期指标后进入三期 voice、ASR、Provider 和长期训练。

提交前只格式化本提交涉及文件。提交信息使用 scope；由 Codex 实质参与的提交按项目规则增加 Codex co-author。

## 17. 第一张开发任务单

正式开发从 `ENG-P1-001` 开始，任务单内容固定为：

### 目标

创建所有跨 Shard/进程使用的稳定类型、Zod schema、功能 ID、错误码和 build channel 类型，不实现业务逻辑。

### 修改范围

- `src/shared/types/live-game-data/`；
- `src/shared/types/live-coach/`；
- `src/shared/shards/live-coach/`；
- `src/shared/shards/feature-gating/keys.ts`；
- 必要的 schema 测试。

### 验收

- P0 文档中的固定 ID 全部存在且唯一；
- current/recorded/historical 在类型层不可混用；
- worker message 逐个通过 schema round-trip；
- secret/raw frame/raw audio 类型不出现在 renderer state；
- cue 最多两个 option 的限制由 schema 强制；
- 所有 public error code 有 zh-CN/en 翻译映射；
- Node 与 Web typecheck 通过；
- 不修改现有 Shard 公开契约。

完成本任务后立即进入 `ENG-P1-002`，不需要等待外部审核。
