# League Akari 实时语音 AI 教练：P0 技术决策

> 文档状态：已冻结，可直接用于开发
> 版本：v1.2
> 最后更新：2026-08-25
> 适用仓库：League Akari 1.5.x 及后续兼容版本
> 适用平台：Windows x64

## 0. 文档作用

本文冻结实时语音 AI 教练开工前必须确定的技术选择。程序员不需要重新比较同类方案；实现如果需要改变本文结论，必须新增 ADR，写明原因、兼容影响、迁移方式、测试证据和回滚方案。

本版范围变更由 [ADR-0001：迷雾推断与装备购买指导进入必做范围](./adr/live-coach-0001-fog-inference-and-item-guidance.md) 和 [ADR-0002：永久红线重新分类](./adr/live-coach-0002-redline-reclassification.md) 批准。

研发范围遵循以下固定规则：

- 除红线外，三个阶段产品清单中的功能全部开发、测试并保留可运行实现；
- 审核、地区和运营状态只控制外部版本是否开启，不删除代码，不中止内部开发；
- 内部构建只供项目负责人开发测试；公开构建默认关闭未获准的实时能力；
- 本文不存在条件性研发范围；审核状态不影响开发排期；
- 未经官方 SDK、公开接口或书面授权的游戏进程内存访问、注入、Hook、驱动、封包篡改、输入自动化、反作弊规避和未授权数据/语音处理永久不实现；功能类别本身不因技术难度、审核状态或外部暂未开放而列为红线。

配套文档：

- [三期产品功能清单](./live-coach-product-feature-list.md)
- [简明功能 Checklist](./live-coach-feature-checklist.md)
- [三期技术实施基线](./live-coach-three-phase-plan.md)
- [开发交付规格](./live-coach-development-spec.md)

## 1. 冻结结论总表

| 决策 ID | 主题            | 冻结结论                                                                                                                                     |
| ------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-D01  | 首发系统        | Windows 10 22H2 x64、Windows 11 x64；其他平台明确显示不支持                                                                                  |
| P0-D02  | 游戏范围        | 一期首发召唤师峡谷 5v5（地图 ID 11）；三期必须扩展 ARAM、斗魂竞技场、轮换模式和观战教练，外部按地图/队列独立开关                             |
| P0-D03  | 空间观测与推断  | 当前采集到的小地图像素是直接空间观测核心；基于小地图、last-seen、地图图结构和允许状态生成独立的概率预测层；LCU、2999、SGP 不直接提供地图坐标 |
| P0-D04  | 当前状态来源    | LCU 管生命周期；Live Client Data 提供当前非空间事实；SGP 只用于赛前/赛后历史增强                                                             |
| P0-D05  | 采集后端        | Windows Graphics Capture 主路径；DXGI Desktop Duplication 备用；Electron desktopCapturer 只用于诊断对照                                      |
| P0-D06  | 进程隔离        | Electron utilityProcess 承载采集与 CV；原生崩溃不得带走 Electron main                                                                        |
| P0-D07  | 视觉运行时      | ONNX Runtime C API；DirectML 优先、CPU 回退；模型格式统一为 ONNX                                                                             |
| P0-D08  | 小地图资源      | LCU 本地游戏资源提供版本与身份元数据；真实 ROI 标注样本训练检测器，不用方形英雄原画直接做匹配                                                |
| P0-D09  | 一期语音        | Windows SAPI 5.4 本地 TTS，支持已安装语音、设备、音量、语速、取消                                                                            |
| P0-D10  | 三期麦克风      | WASAPI shared-mode、16 kHz mono PCM；默认 PTT，同时实现唤醒词与常开模式；VAD 分片，每片最多 20 秒                                            |
| P0-D11  | 三期本地 ASR    | whisper.cpp 多语言模型；默认 small 级别，低配置允许 base 级别；模型按 SHA-256 校验                                                           |
| P0-D12  | 三期本地回答    | 确定性规则与模板完整可用；不把本地生成式模型作为基础依赖                                                                                     |
| P0-D13  | 云端参考实现    | OpenAI：音频转写 + GPT-5.6 Luna Responses 严格结构化输出 + 可选 TTS；所有能力置于可替换 Provider 接口后                                      |
| P0-D14  | 云端调用方式    | 三期统一采用用户自有 API Key（BYOK）直连；三期内不建设自有付费网关                                                                           |
| P0-D15  | 密钥存储        | Electron safeStorage/Windows DPAPI 加密后存本地；不进入 SQLite 明文、日志、崩溃报告或 IPC 状态                                               |
| P0-D16  | 数据存储        | 一期会话默认内存；二期起 SQLite 存结构化会话；原始画面和音频默认不落盘                                                                       |
| P0-D17  | 远程开关        | 现有 feature-gating 做粗粒度门控，教练能力快照做地区/队列/补丁/功能细粒度门控                                                                |
| P0-D18  | UI 落点         | 主窗口增加 `/live-coach/:section?`；新增独立 coach overlay，不复用现有对局窗口                                                               |
| P0-D19  | 首发语言        | 中文普通话完整交付；英文同属必做，在第三期语言评估通过后启用                                                                                 |
| P0-D20  | 研发/审核负责人 | 项目负责人同时担任产品、内部测试和外部开关批准人；具体编码任务按角色标记                                                                     |
| P0-D21  | 迷雾推断        | 第一期必须实现不可见敌人概率区域、候选路线、到达时间范围和意图预测；每项预测带证据、置信度、时限和撤销机制                                   |
| P0-D22  | 装备购买指导    | 第一期必须实现基于英雄、金币、已有装备、阵容、局势和补丁数据的购买指导；提供备选方案但不执行自动购买                                         |
| P0-D23  | 红线重新分类    | 永久红线仅限未经授权的进程、输入、数据、反作弊和隐私行为；微操、冷却、通信、唤醒词、多模态、shot calling、其他模式等全部进入开发与内部测试   |

## 2. 平台、游戏模式与构建渠道

### 2.1 平台支持

第一阶段最低运行环境固定为：

- Windows 10 22H2 x64 或 Windows 11 x64；
- 4 核 8 线程、支持 AVX2 的 CPU；
- 8 GB 内存，推荐 16 GB；
- 支持 DirectX 12 的 GPU 用于 DirectML；不满足时使用 CPU 回退；
- 1080p 与 1440p、100%–150% DPI 作为第一期正式矩阵；
- 第二期完成 4K、21:9、32:9、HDR、150%–200% DPI 和独占全屏矩阵；
- 语音问答需要可用的麦克风和输出设备。

macOS 版本继续构建，但教练能力返回 `unsupported-platform`，不得加载 Windows 原生采集、视觉或音频模块。

### 2.2 游戏范围

- 一期首发地图为召唤师峡谷，`mapId = 11`；
- 一期内部构建必须覆盖训练模式、自定义、匹配、单双排与灵活排位；
- 二期完成多地图 discovery、适配器和数据集基座；三期必须正式支持 ARAM、斗魂竞技场、轮换模式和观战教练；
- 云顶之弈使用独立玩法模型和产品入口；本三期完成数据/窗口可行性 discovery，后续实施不得复用召唤师峡谷规则冒充支持；
- 队列 ID 不写死为单个列表，使用 LCU 游戏数据和能力快照共同判断；
- 未识别地图、队列或补丁一律进入 `unsupported` 或 `unknown`，不输出实时提示。

### 2.3 构建渠道

构建时生成只读常量：

```ts
type LiveCoachBuildChannel = 'internal' | 'public'
```

- `internal`：项目负责人自用，允许开启未对外开放但非红线的能力；
- `public`：公开构建，Gate A/B 和细粒度能力快照默认关闭；
- 构建渠道不能通过设置页、命令行参数或远程配置由普通用户切换；
- 内部渠道只绕过“外部审核状态”，不绕过采集健康、补丁、准确率、性能、隐私授权和红线检查。

构建命令固定如下：

- `yarn dev` / `yarn dev:no-watch`：开发环境，编译为 `internal`；
- `yarn build:win:internal`：项目负责人自用测试安装包，编译为 `internal`；
- `yarn build:win`：公开安装包，默认编译为 `public` 并严格应用 Gate A/B；
- 渠道值在 Electron 主进程构建时写入只读常量，安装完成后不存在设置项或运行参数可以切换。

## 3. 数据来源与权威边界

### 3.1 数据源职责

| 数据源                | 允许用途                                                                                                     | 禁止误用                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 当前小地图 ROI        | 当前可见单位、粗区域、聚集、移动趋势、Ping、兵线/眼位等直接空间观察；作为 last-seen 与迷雾概率模型的主要证据 | 不能把预测伪装成当前直接观测       |
| LCU gameflow/session  | 阶段、地图、队列、当前登录身份、游戏启动和结束                                                               | 不提供当前地图坐标                 |
| Live Client Data 2999 | 游戏时间、玩家、等级、装备、死亡、分数、已发生事件                                                           | `position` 字段不是地图坐标        |
| LCU 历史接口          | 当前登录区服的历史数据                                                                                       | 不覆盖当前小地图事实               |
| SGP                   | 明确端点支持时的赛前/赛后历史增强                                                                            | 不作为当前空间事实，不假设通用跨区 |
| 第三期完整画面        | 近身相对位置、动作、血条、技能表现和战斗状态                                                                 | 不替代小地图宏观空间，不证明迷雾   |
| 第三期授权音频        | 语音转写、声学事件、沟通强度、协同意图和情绪趋势                                                             | 不自动证明游戏事件或说话者真实身份 |
| 用户自述              | 训练目标、偏好、反馈                                                                                         | 不覆盖传感器事实                   |
| LLM                   | 组织已经验证的事实和候选选项，排序并突出当前首选                                                             | 不创造观测、无证据预测或候选外动作 |

### 3.2 2999 轮询

新增 `live-game-data-main`，复用 `GameClientMain.api`，不创建第二个 2999 Axios client。

默认轮询节奏：

| Domain       | Endpoint                       | 活跃间隔 | 用途                   |
| ------------ | ------------------------------ | -------: | ---------------------- |
| gameStats    | `/liveclientdata/gamestats`    |   500 ms | 游戏时间与基础状态     |
| players      | `/liveclientdata/playerlist`   |   500 ms | 玩家、装备、死亡、分数 |
| events       | `/liveclientdata/eventdata`    |   500 ms | 已发生事件增量         |
| activePlayer | `/liveclientdata/activeplayer` |  1000 ms | 本人详细状态           |

规则：

- 没有消费者或 gameflow 不在 `InProgress` 时不轮询；
- 同一 domain 不允许并发请求；超时或取消后才能发下一次；
- 单次超时默认 400 ms，连续失败按 500/1000/2000 ms 退避；
- 成功后恢复默认间隔，必须有滞回，不能在错误边界频繁抖动；
- 每个快照带 `observedAt`、`receivedAt`、`sequence`、`freshness` 和 `sourceHealth`；
- 游戏结束先发 reset，再停止轮询；
- `respawn-timer-main` 与 CD Timer 迁移为订阅者，但公开状态、设置和 IPC 不变。

### 3.3 SGP

SGP 只服务历史/赛前增强，沿用现有 `SgpMain` 和 League Servers 配置。

每次调用必须分别确认：

1. 所需 token 类型已经就绪；
2. 目标 SGP server 有明确配置；
3. 具体 endpoint 对该功能声明支持；
4. token 区域与目标区域的互操作性已被该 endpoint 单独验证；
5. 直连网络可用；
6. 返回语义与 LCU 回退字段一致。

腾讯跨子区不得从共享域名、相似 URL、token ready 或旧字段推断。失败状态必须区分 `config-missing`、`token-not-ready`、`endpoint-unsupported`、`region-incompatible`、`network-error` 和 `not-found`。

## 4. 屏幕采集与进程隔离

### 4.1 主采集后端

使用 Windows Graphics Capture：

- 通过 `League of Legends.exe` PID 找到主 HWND；
- 使用 `IGraphicsCaptureItemInterop::CreateForWindow` 创建捕获对象；
- D3D11 frame pool 接收帧；
- SDR 使用 BGRA8；HDR 使用 RGBA16F 后在 worker 内 tone-map 到 SDR；
- 每次只把小地图 ROI 送入 CV 队列；
- 游戏窗口变化、DPI 变化、分辨率变化或 frame size 变化时重新标定；
- 游戏最小化、黑帧、受保护内容或捕获终止时立刻进入 `unknown`。

### 4.2 备用后端

DXGI Desktop Duplication 只在 WGC 不可用、黑帧或独占全屏失败时启用：

- 仅捕获游戏所在显示器；
- 仅在游戏前台时处理；
- 完整显示器帧只存在于 worker 的 GPU/内存中，立即裁剪 ROI；
- 不把完整帧传给 main、renderer、日志或磁盘；
- 显示器切换后重新创建 duplication session；
- 如果无法证明窗口与显示器 ROI 对齐，停止而不是继续猜测。

Electron `desktopCapturer` 只用于 P0 对照、诊断和回归，不作为正式实时路径。

### 4.3 utility process

新增独立入口 `src/main/utility-processes/minimap-observer/index.ts`，由 `utilityProcess.fork` 启动，serviceName 固定为 `LeagueAkari Minimap Observer`。

进程协议：

| 方向          | 消息                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| main → worker | `initialize`、`start`、`stop`、`update-config`、`request-preview`、`ping`、`shutdown`                |
| worker → main | `ready`、`heartbeat`、`status`、`observation-batch`、`preview-result`、`metrics`、`error`、`stopped` |

硬约束：

- 所有消息使用共享 Zod schema 验证；
- 每局 sequence 从 1 开始单调递增；
- 心跳 1 秒一次，3 秒未收到视为失联；
- 10 分钟最多自动重启 3 次，超过后进入 `crash-loop` 并停止本局；
- 图像队列容量 3，latest-wins，永不让旧帧阻塞新帧；
- frame age 超过 300 ms 时丢弃；
- main 只接收结构化观察和指标；
- 标定预览必须由用户主动请求，最长边不超过 512 px，单次不超过 512 KiB，30 秒自动失效。

## 5. 视觉运行时与模型

### 5.1 运行时

- 原生模块扩展位于 `native/win32-x64`；
- 采集与 CV 绑定加载在 utility process，不在 Electron main 加载重模型；
- ONNX Runtime 使用 C API；
- DirectML 是首选 execution provider；
- 初始化 DirectML 失败、GPU 黑名单或运行时错误时回退 CPU provider；
- DirectML session 使用 sequential execution，并关闭不兼容的 memory pattern；
- 导出模型统一使用 ONNX opset 17；升级 opset 必须先完成 DirectML/CPU 双路径回归；
- 每个模型固定 opset、输入尺寸、归一化参数、类别表、SHA-256 和许可证信息；
- 模型与补丁支持清单不匹配时 fail-closed。

训练工具链固定为 Python 3.12、PyTorch、torchvision 和独立锁文件；目标检测首个基线使用 Apache-2.0 许可的 YOLOX Nano/Tiny 架构，身份分类使用 MobileNetV3 Small，追踪使用项目自有的 Kalman/IoU/Hungarian 组合。模型训练脚本位于 `tools/live-coach-ml/`，Electron 运行包不携带 PyTorch。

离线录像解码固定使用独立 FFmpeg 可执行文件，采用允许再分发的 LGPL build，不启用 GPL/nonfree codec。通过 `execFile` 参数数组启动，不拼接 shell 命令；FFmpeg 版本、许可证、SHA-256 和 source offer 随发布产物归档。解码后的帧通过有界管道进入同一 CV worker，取消导入时终止进程并清理临时文件。

### 5.2 检测器拆分

每个检测器独立版本、阈值、开关和指标：

1. ROI 定位与健康；
2. 本人图标；
3. 友方/敌方单位；
4. 英雄身份分类；
5. 目标资源区域；
6. Ping；
7. 兵线/小兵；
8. 眼位；
9. 追踪与移动趋势；
10. 聚集与局部可见人数。

第一期必须完成 1–3、基础区域、追踪和高优先级变化；第二期补齐其余检测器。身份不足时必须降级为“友方单位/敌方单位”，不得强制选择英雄。

### 5.3 数据与标注

代码仓库只保存无个人信息的小型回归夹具；完整训练数据位于受控数据目录，不进入 Git。

建议布局：

```text
live-coach-data/
  manifests/
    dataset-v1.jsonl
  roi/
    <sha256>.png
  labels/
    <sha256>.json
  clips/
    <artifact-id>/
  reports/
    <model-version>/
```

每个标注必须包含：

- artifact ID、帧时间、游戏补丁、分辨率、DPI、UI/小地图缩放、左右侧；
- 采集后端、SDR/HDR、窗口模式；
- ROI 边界与健康状态；
- 图标类别、可选英雄 ID、中心点、遮挡、置信标注；
- 数据授权类别与撤回 ID；
- 标注人、复核人、schema 版本。

LCU 本地 `/lol-game-data/assets` 只提供版本、英雄 ID、名称和辅助素材。视觉模型必须用真实小地图 ROI 样本训练和验证。

### 5.4 迷雾推断与装备推荐

迷雾推断固定由 `live-coach-main` 中的确定性状态估计器执行，不由 CV worker 或 LLM 自由猜测。输入包括当前与历史小地图观察、last-seen、英雄基础移动能力、已确认位移状态、地图可达图、游戏时间、死亡/回城确认和已发生目标事件。输出至少包含：

- 敌人预测区域或概率热区；
- 最多三条候选路线；
- 到达目标区域的时间范围；
- 游走、回城、埋伏、包夹、资源集结和换线等意图概率；
- 支持证据 ID、反证条件、模型/规则版本、生成时间和失效时间。

预测不得覆盖原始观测。任何 UI、语音、导出和问答都必须使用独立的 `predicted` 来源与“可能/预计/风险”措辞。新观测与预测冲突时立即撤销旧预测；模型不确定时输出 `unknown`。

装备购买指导固定由版本化装备规则和数据表执行。输入包括英雄、位置、等级、当前金币、已有装备、装备栏、敌我阵容、伤害/控制/回复结构、游戏模式、补丁和用户方案。输出至少包含推荐购买顺序、当前可买组件、金币差额、替代方案、购买后剩余金币、适用条件和数据版本。不得通过键鼠模拟、客户端接口或游戏输入执行购买。

## 6. 本地语音、麦克风与 ASR

### 6.1 一期本地 TTS

在 `league-akari-native-win32` 增加 speech 模块，使用 SAPI 5.4：

- 枚举已安装 voice token；
- 中文优先选择系统中文语音，找不到时显示明确不可用；
- 使用 `ISpVoice::SetOutput` 选择输出设备；
- 支持音量、语速、暂停、立即取消和 purge；
- 每次播放返回可取消 operation ID；
- 语音取消 p95 必须达到技术基线指标；
- 不通过 PowerShell 启动语音，不依赖主窗口存活。

### 6.2 麦克风

- WASAPI shared-mode；
- 16 kHz、16-bit、mono PCM 作为 ASR 内部标准；
- 设备原始格式由 audio client 重采样；
- 默认 Push-to-Talk，同时实现用户主动开启的唤醒词和常开模式；
- 开始录音前先打断正在播放的 TTS；
- PTT/切换模式在松键、再次按键、VAD 静音或 20 秒上限时结束；常开模式以相同上限滚动切片；设备拔出、撤权和会话结束立即停止；
- 系统 loopback、队伍语音或其他应用音频按来源分别授权；来源不可合法取得或未授权时零采集；
- 常开和外部音频始终显示不可忽略的采集来源与状态，可一键暂停和逐项撤权；
- 原始 PCM 默认只在内存，提交完成或取消后立即清理。

### 6.3 本地 ASR

- 使用 whisper.cpp；
- 中文/多语言默认使用 small 级模型；
- 低配置可选择 base 级模型，但必须独立展示准确率差异；
- 模型按需下载到 userData 下的模型目录，必须验证 SHA-256；
- partial 结果只显示，不进入意图解析；
- final 结果进入意图与槽位解析；
- 英雄、区域、资源和动作词表作为 prompt/context；
- 关键槽位置信度不足时要求重说或确认；
- 本地模型不可用时始终保留文字输入和第二期模板能力。

## 7. 云端 AI 参考实现

### 7.1 Provider 边界

冻结以下接口职责，不把业务逻辑写进供应商 adapter：

```ts
interface CoachAsrProvider {
  transcribe(request: CoachAsrRequest, signal: AbortSignal): Promise<CoachTranscript>
}

interface CoachResponseProvider {
  createAnswerPlan(request: CoachModelRequest, signal: AbortSignal): Promise<CoachModelAnswerPlan>
}

interface CoachTtsProvider {
  synthesize(request: CoachTtsRequest, signal: AbortSignal): AsyncIterable<CoachAudioChunk>
}
```

本地实现与云端实现都遵循相同的取消、超时、用量和错误分类契约。

### 7.2 OpenAI 参考 adapter

- ASR：Audio Transcriptions；初始内部测试模型使用 `gpt-4o-mini-transcribe`，模型 ID 可由经过验证的配置更新；
- 回答：Responses API；初始内部测试模型使用 `gpt-5.6-luna`，它只负责短结构化回答计划；
- 输出：严格 JSON Schema Structured Outputs，不使用普通 JSON mode 作为验收路径；
- TTS：可选 Audio Speech；初始内部测试模型使用 `gpt-4o-mini-tts`；
- 用户界面明确披露听到的是 AI 生成语音；
- 不使用端到端自由 speech-to-speech 直接播报，因为它会绕过本地事实、候选动作和时效校验；
- 原始屏幕、完整录像和 ROI 帧不发送给模型；
- 模型只收到最小结构化事实、证据 ID、候选动作、语言、长度和语气要求。

Responses 模型 ID不得散落在代码中。内部构建从安全配置读取；公开构建由已评估、可熔断的服务端配置提供。选择的模型必须支持严格 Structured Outputs。

### 7.3 模型输出结构

模型只能返回：

```ts
interface CoachModelAnswerPlan {
  result: 'answer' | 'refuse'
  factIds: string[]
  optionIds: string[]
  answerText: string
  spokenText: string
}
```

本地 validator 必须执行：

- `factIds` 是请求事实集合的子集；
- `optionIds` 是候选选项集合的子集，最多两个；
- 每个数字、英雄、区域、资源和时间表达都能映射到输入事实；
- 不含禁用动作、强制命令、不可见位置、保证性结论和攻击性内容；
- 证据仍未过期；
- spokenText 符合字数和时长上限；
- 任一校验失败整条拒绝并回退本地模板，不做“修一半继续播”。

### 7.4 超时和回退

| 环节          |  软超时 |  硬超时 | 回退                |
| ------------- | ------: | ------: | ------------------- |
| 本地 ASR      |  800 ms | 1500 ms | 云端 ASR 或请求重说 |
| 云端 ASR      | 1200 ms | 2000 ms | 文字输入/请求重说   |
| Responses     | 1000 ms | 1500 ms | 本地结构化模板      |
| 云端 TTS 首包 |  800 ms | 1200 ms | 本地 SAPI           |

任何云端请求都不得阻塞采集、CV、规则引擎或高优先级本地警告。

### 7.5 密钥与部署

- 内部构建允许项目负责人输入自有 API Key；
- Key 使用 Electron `safeStorage` 加密，密文单独存于 userData；
- renderer 只能调用“设置/删除/测试”，不能读回明文；
- 日志只记录 provider、请求 ID、模型 ID、用量、延迟和错误类别；
- 公开版本不得内置项目 API Key；
- 三期公开版本只允许用户显式提供自己的 Provider Key，不内置项目 Key；
- 三期内不建设 Akari 付费网关、账号计费或共享额度；以后若改为项目代付，必须另立 ADR 和独立后端安全设计；
- 开发、测试、生产分别使用独立 provider project 和预算。

## 8. 存储、隐私与保留期

### 8.1 默认保留

| 数据               | 默认                             |
| ------------------ | -------------------------------- |
| 完整游戏画面       | 不保存                           |
| 实时 ROI 帧        | 不保存                           |
| 原始麦克风音频     | 不保存                           |
| 一期结构化会话     | 仅内存，退出清除                 |
| 二期详细事件       | 30 天                            |
| 会话摘要与训练计划 | 180 天                           |
| 用户反馈           | 180 天                           |
| 云端用量记录       | 180 天                           |
| 授权记录           | 授权有效期及撤回后的审计最小记录 |

用户可以缩短、延长、立即导出或删除结构化数据。样本改进、诊断日志、云端 ASR、云端 AI、画像和云同步分别授权。

### 8.2 SQLite

第二期新增 Entity：

- `CoachSession`；
- `CoachEvent`；
- `CoachFeedback`；
- `CoachTrainingPlan`；
- `CoachCloudUsage`；
- `CoachConsent`。

实体加入 `StorageMain` 的 DataSource，数据库版本从当前版本递增，使用单次事务升级。game ID 使用字符串存储，避免平台差异和数值精度问题。

原始 ROI、录像和音频不进入 SQLite BLOB。用户主动贡献的样本存入独立目录，使用撤回 ID 管理。

## 9. 能力开关

### 9.1 固定功能 ID

| 功能 ID                           | 含义                       |
| --------------------------------- | -------------------------- |
| `coach.offline-review`            | 导入录像与离线复盘         |
| `coach.capture.screen`            | 真实游戏窗口采集           |
| `coach.analyze.minimap-basic`     | 基础小地图观察             |
| `coach.analyze.minimap-advanced`  | 高级态势检测               |
| `coach.analyze.fog-inference`     | 迷雾与不可见敌人预测       |
| `coach.guidance.item-purchase`    | 装备购买指导               |
| `coach.guidance.micro`            | 连招、补刀、走位与微操指导 |
| `coach.track.cooldowns`           | 技能、召唤师技能与资源计时 |
| `coach.communication.ping`        | Ping 建议与获准发送        |
| `coach.communication.chat`        | 喊话、聊天与沟通辅助       |
| `coach.analyze.screen-multimodal` | 完整画面多模态分析         |
| `coach.output.shot-calling`       | 主动连续战术指挥           |
| `coach.output.subtitle`           | 实时字幕                   |
| `coach.output.sound`              | 提示音                     |
| `coach.output.tts`                | 实时 TTS                   |
| `coach.qa.text`                   | 文字问答                   |
| `coach.qa.microphone`             | PTT 和本地 ASR             |
| `coach.qa.wake-word`              | 唤醒词与常开麦克风         |
| `coach.qa.voice-analysis`         | 获准语音/声音/情绪分析     |
| `coach.qa.cloud-asr`              | 云端 ASR                   |
| `coach.qa.cloud-llm`              | 云端回答增强               |
| `coach.qa.cloud-tts`              | 云端语音                   |
| `coach.history.sgp`               | SGP 历史增强               |
| `coach.profile.longitudinal`      | 长期画像与训练计划         |
| `coach.training.leaderboard`      | 匿名训练分位与排行榜       |
| `coach.data.sample-upload`        | 用户主动贡献样本           |
| `coach.mode.aram`                 | 极地大乱斗支持             |
| `coach.mode.arena`                | 斗魂竞技场支持             |
| `coach.mode.rotating`             | 轮换模式支持               |
| `coach.mode.spectator`            | 观战教练支持               |

### 9.2 Gate

现有 FeatureGating keys 新增：

- `live-coach.capture`；
- `live-coach.realtime-output`；
- `live-coach.voice-qa`；
- `live-coach.cloud-ai`；
- `live-coach.sample-upload`。

细粒度 `LiveCoachCapabilitySnapshot` 必须覆盖：

- build channel；
- 平台与应用版本；
- SGP server/地区；
- map/queue；
- 游戏补丁；
- 采集后端；
- 分辨率、DPI、HDR、窗口模式；
- detector/feature ID；
- Gate A/B 状态；
- 生成序号、过期时间和 kill switch。

快照使用“payloadBase64 + Ed25519 detached signature + keyId”信封，避免 JSON canonicalization 歧义。客户端内置公钥验证；签名失败、过期、generation 回退或时钟异常时，公开实时能力关闭。

最终可用能力是以下集合的交集：

```text
build 中存在
∩ 非红线
∩ 本地平台支持
∩ 当前会话支持
∩ 补丁/模型支持
∩ 采集与数据源健康
∩ 用户授权与设置
∩ 远程未禁用
∩ 外部版本 Gate A/B 已开启
```

内部构建只移除最后一项“外部 Gate”，其他安全和质量条件全部保留。

## 10. Shard、窗口与公开契约

### 10.1 固定 Shard ID

- `live-game-data-main`；
- `minimap-observer-main`；
- `live-coach-main`；
- `live-coach-renderer`；
- `coach-voice-main`（第三期）。

依赖方向：

```text
LeagueClientMain / GameClientMain
  -> LiveGameDataMain
      -> RespawnTimerMain
      -> CD Timer
      -> LiveCoachMain

MinimapObserverMain
  -> LiveCoachMain

OngoingGameMain / SgpMain
  -> LiveCoachMain

CoachVoiceMain
  <- LiveCoachMain
```

`CoachVoiceMain` 不反向注入 `LiveCoachMain`。LiveCoach 注册 transcript callback，并在事实校验后调用 voice adapter。

### 10.2 窗口和路由

- 主窗口路由：`/live-coach/:section?`；
- 主窗口一级入口：实时教练；
- overlay namespace：`window-manager-main/coach-overlay-window`；
- renderer entry：`src/renderer/coach-overlay-window.html`；
- window source：`src/renderer/src-coach-overlay-window/`；
- overlay 透明、置顶、默认点击穿透；
- 按住交互快捷键时临时取消点击穿透，释放后恢复；
- 使用现有 `data-theme` / `data-theme-id`，不添加 `.dark` 类；
- 交互控件优先使用 Naive UI，翻译内容进入 zh-CN/en YAML。

### 10.3 设置归属

所有用户可见且已公开的教练设置固定归 `live-coach-main` namespace，即使第三期内部更换 voice adapter，也不迁移 key。

原生采集和模型调试参数不作为普通用户设置，只在内部诊断配置中出现。

## 11. 最低验收与停止线

开发必须沿用三期技术基线中的完整指标。P0 再冻结以下不可降低的硬约束：

- 视觉处理最低 5 FPS，目标 10 FPS；
- frame age 超过 300 ms 不进入当前事实；
- 首个可判定帧到 confirmed p95 ≤600 ms；
- confirmed 到首音 p95 ≤900 ms；
- 事件到首音端到端 p95 ≤1.5 s；
- 证据失效到取消播放 p95 ≤200 ms；
- 支持环境 1% low FPS 降幅 <5%，目标 <3%；
- 关键实时播报 Precision 的 95% 下界 ≥98%；
- 迷雾预测必须单独报告区域 top-k 命中率、路线命中率、意图 Precision/Recall、Brier score、ECE、覆盖率和撤销延迟；未完成独立回放评估时不得标记为正式可用；
- 装备推荐的装备存在性、模式可用性、价格、合成路径和唯一限制合法率必须为 100%，补丁数据不匹配时停止推荐；
- 无依据当前事实率单侧 95% 上界 <0.1%；
- 原始画面、音频或密钥越权落盘/上传一次即停止相关能力；
- 未经授权的进程访问、输入自动化、反作弊规避、他人语音/身份处理或受保护数据访问一次即停止相关能力并保全证据；
- utility process crash-loop、采集黑帧、未知补丁和能力快照失效全部 fail-closed。

## 12. 负责人和变更流程

| 事项                               | 负责人               |
| ---------------------------------- | -------------------- |
| 产品范围、内部测试、外部 Gate 批准 | 项目负责人           |
| Electron/main/Shard/IPC            | 客户端开发角色       |
| Windows 采集与原生音频             | Windows 原生开发角色 |
| CV、模型、数据集与指标             | CV/ML 角色           |
| Vue、overlay、交互与 i18n          | 前端角色             |
| ASR/LLM/TTS Provider 与网关        | AI/后端角色          |
| 回放、性能、隐私和端到端测试       | QA/数据角色          |
| 审核材料、联系人和证据归档         | 项目负责人           |

审核与发行证据统一归档到 `docs/compliance/live-coach/<region>/<date>/`。每次归档至少包含覆盖的产品版本、功能 ID、地区、队列、数据源、输出类别、有效期、联系人和撤回信号；该目录中的外部证据不得包含 API Key 或用户原始样本。

当前只有一名开发者时，角色代表工作帽子，不代表可以跳过对应验收。

技术决策变更流程：

1. 新增 `docs/adr/live-coach-XXXX-<topic>.md`；
2. 写明被替代的 P0-Dxx；
3. 列出数据迁移和公开契约兼容影响；
4. 提供回放、性能、真实 Windows 和打包 smoke 证据；
5. 项目负责人批准后更新本文版本。

## 13. 参考资料

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Microsoft Windows Graphics Capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture)
- [IGraphicsCaptureItemInterop::CreateForWindow](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow)
- [Microsoft Desktop Duplication API](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api)
- [ONNX Runtime DirectML Execution Provider](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [Microsoft SAPI ISpVoice](<https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee125640(v=vs.85)>)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI Model Guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI Speech to Text](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI Text to Speech](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenAI Production Best Practices](https://developers.openai.com/api/docs/guides/production-best-practices)
