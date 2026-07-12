# Refora UI/UX Design Audit Report

> 审计日期: 2026-07-12  
> 审计范围: 全部 renderer 层 UI 组件、交互逻辑、设计系统、AI Agent UX  
> 参考产品: ChatGPT, Claude, Cursor, Perplexity, Notion AI, Linear

---

## 目录

- [一、视觉设计 (Visual Design)](#一视觉设计-visual-design)
- [二、UI Layout](#二ui-layout)
- [三、交互设计 (Interaction Design)](#三交互设计-interaction-design)
- [四、AI Agent UX](#四ai-agent-ux)
- [五、可用性 (Usability)](#五可用性-usability)
- [六、可访问性 (Accessibility)](#六可访问性-accessibility)
- [七、前端实现角度](#七前端实现角度)
- [Implementation Plan](#implementation-plan)
- [Roadmaps & Checklists](#roadmaps--checklists)

---

## 一、视觉设计 (Visual Design)

### 问题 #001

**问题名称:** 双设计系统混用导致视觉不一致

**所在页面/模块:** 全局 (App.tsx, 所有组件)

**问题描述:** 应用同时使用三套 UI 系统: (1) Tailwind CSS 自定义类 (`toolbar-btn`, `sidebar-item`, `card`, `field-input`); (2) Ant Design 组件 (`Modal`, `Select`, `Input`); (3) LobeHub UI 组件 (`Button`, `Input`, `showContextMenu`, `Modal`)。同一个语义的按钮在不同位置使用不同系统实现，导致圆角、高度、字号、间距、hover/focus 效果均不一致。

**为什么这是一个问题:** 根据 Material Design 和 Apple HIG 的一致性原则，同一交互元素在整个应用中应保持视觉统一。混用三套系统导致每个组件都需要单独 override 样式（如 `doc-search-input` 的 `!important` hack），增加了维护成本，且用户感知到微妙的视觉差异，降低产品精致度。

**对用户造成的影响:** 用户在浏览不同区域时感到"不连贯"，按钮大小和样式微妙变化增加认知负担。

**优化建议:** 以 Tailwind CSS 为基础，建立统一的 Design System 组件层。Ant Design/LobeHub 组件仅用于复杂交互（如 Modal、Dropdown、ContextMenu），其余全部使用自建组件并映射到 CSS Token。

**优先级:** Critical  
**实现复杂度:** Hard  
**预估收益:** 消除 ~60% 的样式 override 代码，显著提升视觉一致性

---

### 问题 #002

**问题名称:** CSS 变量重复定义 `--color-success`

**所在页面/模块:** `src/renderer/styles/index.css` 第 18-19 行 (dark), 第 57-58 行 (light), 第 82-83 行 (media query)

**问题描述:** `--color-success` 在每个主题块中被定义了两次（第 18 行和第 19 行在 dark 主题中完全重复）。在 light 主题（第 57-58 行）和 media query（第 82-83 行）中也存在同样的重复。第二行覆盖第一行，虽然值相同，但这是明显的代码错误。

**为什么这是一个问题:** DRY 原则违反。虽然当前值相同不会产生 bug，但维护时容易只修改一处而遗漏另一处，导致主题不一致。

**对用户造成的影响:** 当前无直接影响，但存在潜在的主题颜色不一致风险。

**优化建议:** 删除每个主题块中重复的 `--color-success` 定义行。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 代码清洁度提升，消除潜在维护陷阱

---

### 问题 #003

**问题名称:** 字体层级体系未统一使用

**所在页面/模块:** 全局

**问题描述:** CSS 中定义了语义化字体类 (`.text-caption` 10px, `.text-label` 11px, `.text-body-sm` 12px, `.text-body` 14px)，但绝大多数组件直接使用 Tailwind 的 `text-xs` (12px) 和 `text-sm` (14px)。body 字体设为 13px (index.css:108)，但 `.text-body` 是 14px，三者不匹配。ChatPanel 中消息使用 `text-xs`，DetailPanel 字段使用 `text-sm`，DocumentList 行使用 `text-xs` — 同一层级的信息使用了不同字号。

**为什么这是一个问题:** Typography Hierarchy 是视觉层级的核心。ChatGPT/Claude/Linear 都有严格的字体 scale（通常 4-5 级）。当前 13px body + 混用 text-xs/text-sm 导致信息层级模糊，用户难以快速区分标题、正文、辅助文本。

**对用户造成的影响:** 信息扫描效率降低，视觉层次感不足。

**优化建议:** 建立统一的 Typography Token 体系：Display (16px)、Heading (14px)、Body (13px)、Caption (11px)、Micro (10px)。将所有 `text-xs`/`text-sm` 替换为语义化 class。

**优先级:** High  
**实现复杂度:** Medium  
**预估收益:** 信息层级清晰化，视觉专业度提升

---

### 问题 #004

**问题名称:** 图标尺寸不统一

**所在页面/模块:** 全局

**问题描述:** Lucide 图标在不同位置使用不同尺寸：`h-3 w-3` (12px)、`h-3.5 w-3.5` (14px)、`h-4 w-4` (16px)、`h-8 w-8` (32px)、`h-10 w-10` (40px)、`h-12 w-12` (48px)。没有明确的尺寸规范——同一类操作按钮的图标有时是 14px 有时是 16px。例如 Sidebar 中的 `sidebar-header-btn` 的 SVG 被强制为 15px (index.css:394)，但传入的图标 class 是 `h-4 w-4` (16px)，两者冲突。

**为什么这是一个问题:** 图标尺寸一致性是设计系统的基础要素。Lucide 官方推荐 16px/20px/24px 三档。随意尺寸导致视觉重量不均。

**对用户造成的影响:** 微妙的视觉不协调感，降低产品精致度。

**优化建议:** 统一图标尺寸为三档：`icon-sm` (14px, 用于行内/密集 UI)、`icon-md` (16px, 默认按钮)、`icon-lg` (20px, 空状态/标题)。在 Tailwind config 中定义或创建 `<Icon>` wrapper 组件。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 视觉一致性提升

---

### 问题 #005

**问题名称:** 按钮变体 (Button Variant) 未统一

**所在页面/模块:** 全局

**问题描述:** 应用中存在至少 7 种按钮实现方式：
1. `.toolbar-btn` - CSS 组件类 (h-8, rounded-lg)
2. `.sidebar-header-btn` - CSS 组件类 (26x26, rounded-7px)
3. `.sidebar-item` - CSS 组件类 (min-h-34px, rounded-lg)
4. antd/LobeHub `<Button>` - 第三方组件
5. 内联 Tailwind `<button className="rounded-lg bg-accent px-3 py-1.5...">` - 一次性样式
6. `.sidebar-floating-toolbar button` - CSS (26x26 圆形)
7. 纯文本按钮 `<button className="text-xs text-accent hover:underline">`

每种的高度、圆角、padding、hover 效果都不同。

**为什么这是一个问题:** Button 是使用频率最高的交互元素。ChatGPT/Claude/Linear/Vercel 都有清晰的 Button 变体系统（Primary/Secondary/Ghost/Danger，通常 3-5 种）。7 种未命名的按钮实现导致视觉碎片化，新增功能时开发者不知道该用哪种。

**对用户造成的影响:** 按钮视觉权重不一致，Primary CTA 不突出。

**优化建议:** 创建统一 `<Button>` 组件，定义 5 种 variant：`primary`（accent 背景）、`secondary`（panel-2 背景）、`ghost`（透明，hover 显示）、`danger`（error 背景/text）、`link`（纯文本链接）。定义 3 种 size：`sm` (24px)、`md` (32px)、`lg` (40px)。

**优先级:** Critical  
**实现复杂度:** Hard  
**预估收益:** 消除按钮碎片化，大幅提升开发效率和视觉一致性

---

### 问题 #006

**问题名称:** 深色模式与浅色模式阴影差异较大但缺乏过渡

**所在页面/模块:** `src/renderer/styles/index.css` 第 24-26 行 vs 第 63-65 行

**问题描述:** 深色模式阴影使用高透明度黑色 (`rgba(0,0,0,0.3-0.5)`)，浅色模式使用低透明度 (`rgba(0,0,0,0.08-0.12)`)。虽然值合理，但 `body` 的 `transition` 只包含 `background-color` 和 `color` (index.css:112)，阴影和 border 颜色切换时无过渡，导致主题切换时视觉跳变。

**为什么这是一个问题:** 主题切换的平滑过渡是现代 SaaS 应用的基本体验。Linear/Notion 在主题切换时所有属性都有过渡。

**对用户造成的影响:** 切换主题时感到突兀。

**优化建议:** 为 `border-color`、`box-shadow` 添加 transition。或使用 `transition: background-color 0.2s, color 0.2s, border-color 0.2s` 全局应用。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 主题切换体验平滑化

---

### 问题 #007

**问题名称:** 卡片设计风格不协调

**所在页面/模块:** PaperCard.tsx, ReportCard.tsx, DetailPanel.tsx

**问题描述:** PaperCard 使用 `.card` 类 (rounded-xl, border, shadow-sm) + hover 时 `border-accent`。ReportCard 额外添加了 `border-l-2 border-l-accent`（左侧 accent 条）。DetailPanel 没有卡片化设计，直接是 `bg-panel` 全面板。三种"卡片"视觉语言不统一——PaperCard 是标准卡片，ReportCard 有装饰性左条，DetailPanel 无卡片边界。

**为什么是一个问题:** 卡片是信息分组的核心视觉容器。不一致的卡片设计让用户难以理解信息层级关系。

**对用户造成的影响:** Board 区域卡片风格不统一（PaperCard vs ReportCard），视觉节奏被打断。

**优化建议:** 统一卡片设计：所有卡片使用相同的基础 `.card` 类。ReportCard 的左侧 accent 条改为顶部 badge 或图标颜色区分（如 FileBarChart 图标用 accent 色），而非结构性边框差异。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** Board 视觉统一性提升

---

## 二、UI Layout

### 问题 #008

**问题名称:** DetailPanel header 浪费垂直空间

**所在页面/模块:** `src/renderer/components/DetailPanel.tsx` 第 620-630 行, 644-656 行, 670-681 行

**问题描述:** DetailPanel 的三个渲染分支（BulkBar、空状态、SingleDetail）各自有一个 48px 高的 `drag-region` header，其中只有一个 32px 的关闭按钮靠右放置。这 48px 在详情面板这种信息密集区域是显著的浪费。更严重的是，这三个 header 的代码几乎完全相同（DRY 违反）。

**为什么这是一个问题:** 在文献管理场景中，详情面板的垂直空间非常宝贵（元数据字段多）。48px 的 header 只放一个按钮，空间利用率极低。ChatGPT/Claude 的侧边面板 header 通常包含标题 + 操作按钮，高度更紧凑。

**对用户造成的影响:** 可见区域减少，需要更多滚动才能看到完整元数据。

**优化建议:** 将 header 高度降至 36px，左侧显示文档标题（truncate），右侧放关闭按钮。或改为浮动关闭按钮（absolute positioned），不占用 header 空间。提取为共享 `<PanelHeader>` 组件。

**优先级:** High  
**实现复杂度:** Easy  
**预估收益:** 详情面板可用空间增加 ~25%

---

### 问题 #009

**问题名称:** ChatPanel header 信息价值低

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1317-1319 行

**问题描述:** ChatPanel header 中间显示的是静态文本 `t('workspace.chat.title', 'Chat')`，即只显示"Chat"二字。当前对话标题、模型名称、token 使用情况等更有价值的信息都没有展示。左侧是 thread history 按钮，右侧是 new chat 按钮。

**为什么这是一个问题:** Header 是用户定位"我在哪里"的关键位置。显示无信息的"Chat"浪费了最优质的视觉位置。ChatGPT 在 header 显示对话标题，Claude 显示模型名称，Cursor 显示当前文件上下文。

**对用户造成的影响:** 用户无法快速识别当前对话主题，需要打开 thread history 下拉才能看到。

**优化建议:** 将 header 中间替换为当前 thread 标题（truncate），无 thread 时显示 workspace 名称。或显示当前选中的模型名称 + deep thinking 状态指示。

**优先级:** High  
**实现复杂度:** Easy  
**预估收益:** 用户上下文感知显著提升

---

### 问题 #010

**问题名称:** DocumentList 搜索栏居中布局导致信息混乱

**所在页面/模块:** `src/renderer/components/DocumentList.tsx` 第 419-449 行

**问题描述:** 搜索框使用 `mx-auto` 居中，搜索结果计数和列表标题也跟随居中。当用户搜索时，显示 `${t('topbar.search')}: ${displayDocs.length}`；未搜索时显示 `${listModeLabel} · ${documents.length}`。两种状态的信息位置和格式不同，但都挤在搜索框右侧，视觉上难以区分。

**为什么这是一个问题:** 搜索框应左对齐或占满可用宽度，结果计数应与搜索框明确关联。当前居中布局在宽屏下搜索框和计数之间距离过大，在窄屏下又挤在一起。

**对用户造成的影响:** 搜索状态不直观，结果数量不够醒目。

**优化建议:** 搜索框左对齐（在 sidebar collapsed 时预留 traffic light 空间），结果计数作为搜索框内的 badge 或紧邻右侧。列表标题移到搜索框下方或列头栏左侧。

**优先级:** Medium  
**实现复杂度:** Medium  
**预估收益:** 搜索体验和信息架构改善

---

### 问题 #011

**问题名称:** Workspace 面板缺乏入口引导

**所在页面/模块:** `src/renderer/App.tsx`, `src/renderer/components/Sidebar.tsx`

**问题描述:** Workspace 面板默认不显示 (`workspacePanelOpen` 初始为 false)，用户需要先在 Sidebar 中点击一个 workspace 才能打开。但 Sidebar 中 workspace section 的视觉权重很低（普通 sidebar-item），没有暗示"点击这里会打开一个全新的工作区面板"。新用户可能不会发现这个功能。

**为什么这是一个问题:** Workspace + AI Chat 是 Refora 的核心差异化功能。Linear 的 sidebar 中每个项目都有明确的视觉标识。当前 workspace 列表与 categories 列表视觉完全相同，用户无法区分"点击 workspace 会打开新面板"vs"点击 category 只是过滤文档列表"。

**对用户造成的影响:** 核心功能发现性低，新用户可能只用文档管理功能而错过 AI 分析能力。

**优化建议:** (1) Workspace section 使用不同的图标/视觉样式（如带 accent 色背景的 LayoutDashboard 图标）；(2) 首次使用时显示 tooltip 或引导提示；(3) 考虑在 DocumentList header 区域增加"Open in Workspace"按钮。

**优先级:** High  
**实现复杂度:** Medium  
**预估收益:** 核心功能发现性和用户激活率提升

---

### 问题 #012

**问题名称:** Settings Modal 内容组织松散

**所在页面/模块:** `src/renderer/components/SettingsModal.tsx`

**问题描述:** Settings Modal 将所有设置（Library Folder、Proxy、Crossref Mailto、Theme、Language、Sidebar、AI Providers）以平铺的 flex-col gap-4 方式排列，没有分组、没有 section title、没有视觉分隔。AI Providers 部分尤其长（~350 行代码），但与上方的 General settings 之间只有一个 `border-t` 分隔。Modal 没有设置最大高度和滚动区域，内容多时可能超出视口。

**为什么这是一个问题:** 设置面板的信息架构应该按功能分组（General / Appearance / AI / Advanced）。VS Code、Linear、Notion 的设置都有明确的 section 分组。平铺排列导致用户需要扫描全部内容才能找到目标设置。

**对用户造成的影响:** 设置查找效率低，AI Providers 配置流程过长。

**优化建议:** (1) 将设置分组为 Section（General / Appearance / AI Providers / Advanced），每组有标题和描述；(2) Modal body 设置 `max-height: 70vh; overflow-y: auto`；(3) 考虑使用 Tabs 分离 General 和 AI Providers。

**优先级:** Medium  
**实现复杂度:** Medium  
**预估收益:** 设置查找效率提升，AI 配置体验改善

---

### 问题 #013

**问题名称:** ChatPanel 输入区域信息密度过高

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1571-1967 行

**问题描述:** 输入区域在一个 `rounded-xl border` 容器内塞入了：附件预览栏、textarea、附件按钮、workspace scope 按钮、字符计数、模型选择器、deep thinking 开关、发送/停止按钮。这些元素分布在两行 `flex` 容器中，视觉上非常拥挤。特别是第一行有 attach + workspace scope + chars remaining，第二行有 model selector + deep thinking + send button。模型选择器展开后的下拉菜单有 4 个 section（Provider models、Available models、Recent、Custom model + Variant），信息量极大。

**为什么这是一个问题:** ChatGPT/Claude 的输入区域极其简洁——只有 textarea + send button，高级选项藏在 popover 中。当前设计将所有控制项暴露在主视图，违反了 Progressive Disclosure 原则。

**对用户造成的影响:** 输入区域视觉噪音大，分散用户对对话内容的注意力。

**优化建议:** (1) 将 model selector、deep thinking 移到 header 或 popover 中；(2) workspace scope 改为 inline chip 显示在 textarea 上方；(3) 附件按钮保留但缩小；(4) 简化 model selector 下拉为搜索式选择器（类似 Cursor 的 model picker）。

**优先级:** High  
**实现复杂度:** Medium  
**预估收益:** 输入体验显著简化，聚焦对话本身

---

## 三、交互设计 (Interaction Design)

### 问题 #014

**问题名称:** 删除确认对话框模式不统一

**所在页面/模块:** Sidebar.tsx (2 处), ChatPanel.tsx (1 处), ConfirmDialog.tsx (全局)

**问题描述:** 应用中有 4 种删除确认实现：
1. `ConfirmDialog.tsx` - 使用 LobeHub `<Modal>` 的全局确认对话框（用于文档删除）
2. `Sidebar.tsx:803-823` - 内联 `dialog-overlay` + `dialog-panel` 确认删除 Category
3. `Sidebar.tsx:825-845` - 完全相同的内联确认删除 Workspace（代码几乎复制粘贴）
4. `ChatPanel.tsx:1969-1997` - 内联 `dialog-overlay` + `dialog-panel` 确认删除 Thread

三种内联实现使用自定义 `dialog-overlay`/`dialog-panel` 类，而 ConfirmDialog 使用 LobeHub Modal。视觉效果不完全一致。

**为什么这是一个问题:** 相同交互（删除确认）应使用相同组件。Jakob's Law 指出用户期望相似的操作有相似的交互方式。4 种实现增加了维护成本。

**对用户造成的影响:** 不同位置的删除确认弹窗微妙不同（遮罩、动画、按钮样式），降低信任感。

**优化建议:** 统一使用 `ConfirmDialog` 组件（扩展为通用 confirm dialog store），所有删除操作通过 `useDocumentStore.getState().requestDeleteConfirm()` 或类似的通用 confirm store 触发。

**优先级:** High  
**实现复杂度:** Medium  
**预估收益:** 代码量减少 ~100 行，交互一致性提升

---

### 问题 #015

**问题名称:** Toast 组件代码重复 3 次

**所在页面/模块:** `src/renderer/components/DetailPanel.tsx` 第 632-638 行, 659-665 行, 683-689 行

**问题描述:** 完全相同的 Toast 组件代码在 DetailPanel 的三个渲染分支中重复了三次：
```tsx
{toastMessage && (
  <div className="fixed bottom-5 right-5 z-50 animate-slide-up rounded-xl bg-panel px-4 py-2.5 text-xs text-foreground"
    style={{ boxShadow: 'var(--shadow-md)' }}>
    {toastMessage}
  </div>
)}
```

**为什么这是一个问题:** DRY 原则严重违反。Toast 应该是全局组件，而不是在每个面板中重复。如果需要修改 Toast 样式或位置，需要改 3 处（还可能遗漏其他组件中的 Toast）。

**对用户造成的影响:** 当前无直接影响，但 Toast 出现位置可能因渲染分支不同而不一致。

**优化建议:** 提取全局 `<Toast>` 组件，在 App.tsx 层渲染。Toast store 已存在 (`toastMessage` in documentStore)，只需在 App 层订阅并渲染一次。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 消除重复代码，Toast 行为全局一致

---

### 问题 #016

**问题名称:** 主题切换使用循环点击而非选择器

**所在页面/模块:** `src/renderer/components/Sidebar.tsx` 第 510-514 行

**问题描述:** 主题切换通过 `cycleTheme()` 函数循环切换 system → light → dark → system。用户点击 sidebar 底部的主题按钮，每次点击切换到下一个模式。当前模式通过图标 (Moon/Sun/Monitor) 和文字标签表示。

**为什么这是一个问题:** 循环点击是低效的交互模式——如果用户想从 dark 切到 system，需要点击两次（dark → system）。更关键的是，用户无法预知下一次点击会切到什么模式。现代应用（VS Code、Linear、Notion）都使用下拉菜单或分段控件。Sidebar footer 已经有 Settings 和 Export 按钮，再加一个循环切换的主题按钮显得拥挤。

**对用户造成的影响:** 主题切换效率低，操作不可预测。

**优化建议:** (1) 将主题切换移到 Settings Modal 中（已有 Select 组件）；(2) Sidebar footer 的主题按钮改为 popover with 3 options；(3) 或移除 Sidebar 中的主题按钮，只在 Settings 中提供。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 主题切换体验改善

---

### 问题 #017

**问题名称:** Category 添加 UI 使用原生 `<select>` 元素

**所在页面/模块:** `src/renderer/components/DetailPanel.tsx` 第 313-332 行 (CategoryChips), 第 575-588 行 (BulkBar)

**问题描述:** CategoryChips 组件中点击"+"按钮后显示一个原生 HTML `<select>` 元素来选择分类。BulkBar 中也使用原生 `<select>` 来批量分类。原生 select 的样式无法完全自定义，与应用的圆角、字体、颜色体系不一致。

**为什么这是一个问题:** 原生 `<select>` 在不同操作系统上外观不同（macOS 的 select 有蓝色 highlight），与应用的自定义设计语言冲突。应用其他地方使用了 LobeHub 的 `showContextMenu` 和 `Select` 组件来处理类似的选择场景。

**对用户造成的影响:** 视觉不一致，原生 select 的下拉列表样式与应用其他部分不协调。

**优化建议:** 使用 LobeHub `<Select>` 组件或 `showContextMenu` 替代原生 `<select>`。CategoryChips 的"+"按钮可以改为弹出 context menu 列出可选分类。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 视觉一致性提升

---

### 问题 #018

**问题名称:** Empty State 设计过于简陋

**所在页面/模块:** DocumentList.tsx (第 457-459 行), Board.tsx (第 248-251 行), DetailPanel.tsx (第 656-658 行)

**问题描述:** 三处 Empty State 都只是一行灰色文字：
- DocumentList: `"Your library is empty"` / `"No documents match your search."`
- Board: `"Drag papers here to add them to the workspace"`
- DetailPanel: `"Select a document to view details"`

没有图标、没有引导按钮、没有说明插图。

**为什么这是一个问题:** Empty State 是新用户第一次接触功能时的关键触点。ChatGPT 的空状态有建议 prompt、Claude 有能力说明、Notion 有模板引导。纯文字的空状态缺乏引导性，用户不知道接下来该做什么。

**对用户造成的影响:** 新用户引导不足，可能放弃使用。

**优化建议:** (1) DocumentList 空状态：添加 FileText 大图标 + "Import your first PDF" CTA 按钮；(2) Board 空状态：添加拖拽示意图 + "or click to browse" 按钮；(3) DetailPanel 空状态：添加文档选择提示图标。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 新用户激活率提升

---

### 问题 #019

**问题名称:** Loading 状态反馈不够丰富

**所在页面/模块:** DocumentList.tsx (SkeletonRows), ChatPanel.tsx (thinking dots), Board.tsx (summarizing spinner)

**问题描述:** 各处 Loading 状态设计不一致且信息量不足：
- DocumentList: 5 行 shimmer skeleton（合理）
- ChatPanel streaming 无内容时：3 个 bounce dots + "Thinking…" 文字（合理但缺少进度信息）
- ChatPanel loading history：3 个 shimmer bubble（合理）
- PaperCard summarizing：小 spinner + "Summarizing…"（合理）
- Settings Modal test provider："testing" 状态通过 button loading prop（合理但无进度）
- Sidebar import progress：进度条 + "Importing X/Y PDFs"（最佳实践，但仅此处有）
- Sidebar metadata refresh：小 spinner + "Refreshing metadata (N)"（合理）

**为什么这是一个问题:** 各处 Loading 设计不一致，且大部分缺少预估时间或进度信息。Import progress 是最佳实践但未推广到其他场景。

**对用户造成的影响:** 长时间操作时用户不知道还要等多久。

**优化建议:** 统一 Loading 组件体系：Skeleton（列表/卡片）、Spinner + Label（操作中）、Progress Bar（可量化进度）。AI 操作增加 elapsed time 显示。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 等待体验改善

---

### 问题 #020

**问题名称:** 文档列表 checkbox 点击区域过小

**所在页面/模块:** `src/renderer/components/DocumentList.tsx` 第 499-508 行

**问题描述:** 文档列表行中的 checkbox 大小为 `h-3 w-3` (12px x 12px)，远小于 Apple HIG 推荐的 44px x 44px 最小触摸目标。实际可点击区域虽由外层 button 包裹，但 checkbox 本身的视觉大小让用户觉得需要精确点击。同时 checkbox 使用 `e.stopPropagation()` 阻止行选中，但点击 checkbox 旁边的空白区域会触发行选中而非 checkbox 切换。

**为什么这是一个问题:** Fitts's Law 指出目标越小、距离越远，操作时间越长。12px 的 checkbox 在密集列表中需要精确瞄准。

**对用户造成的影响:** 多选操作效率低，容易误触发行选中。

**优化建议:** (1) 增大 checkbox 视觉尺寸到 `h-4 w-4` (16px)；(2) checkbox 容器列宽从 32px 增加到 40px；(3) 整个 checkbox 列区域点击都触发 toggle。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 多选操作效率提升

---

### 问题 #021

**问题名称:** 缺少操作快捷键提示

**所在页面/模块:** 全局

**问题描述:** 应用定义了快捷键（`useAppShortcuts.ts`），ChatPanel 有 Cmd+L 聚焦输入框，但没有在 UI 中任何地方显示快捷键提示。tooltip 中也没有附带快捷键后缀（如 "New Chat ⌘N"）。

**为什么这是一个问题:** 快捷键是高级用户效率的关键。ChatGPT/Claude/Linear 都在 tooltip 和菜单中显示快捷键。隐藏快捷键导致大部分用户永远发现不了。

**对用户造成的影响:** 高级用户效率受限，键盘操作可发现性低。

**优化建议:** 在所有有快捷键的按钮 tooltip 中添加快捷键后缀。格式：`"New Chat (⌘N)"` 或使用 `<kbd>` 样式。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 键盘操作可发现性提升

---

## 四、AI Agent UX

### 问题 #022

**问题名称:** Thread History 使用下拉菜单而非持久侧边栏

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1205-1316 行

**问题描述:** 对话历史通过 ChatPanel header 左侧的 `MessageSquare` 按钮触发下拉菜单展示。threads 列表在一个 `w-56` (224px) 的浮层中，每项有标题、rename 按钮、delete 按钮。当 threads 数量多时，在 `max-h-64` 的浮层中滚动查找效率低。

**为什么这是一个问题:** ChatGPT 和 Claude 都将对话历史放在持久侧边栏中，用户可以随时看到、搜索、切换对话。下拉菜单模式要求用户先点击才能看到列表，增加了操作步骤。对于文献研究场景，用户可能需要在多个对话间频繁切换（如对比不同论文集的分析结果），下拉菜单模式效率很低。

**对用户造成的影响:** 多对话管理困难，切换对话需要 2 次点击（打开菜单 + 选择）。

**优化建议:** (1) 短期：在 ChatPanel 左侧增加可折叠的 thread 列表面板（类似 ChatGPT sidebar）；(2) 增加 thread 搜索功能；(3) thread 列表项显示最后消息时间或摘要。

**优先级:** High  
**实现复杂度:** Hard  
**预估收益:** 对话管理效率显著提升

---

### 问题 #023

**问题名称:** 流式响应缺少进度时间指示

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1496-1507 行

**问题描述:** 当 AI 正在响应但尚未输出任何 token 时，显示 3 个 bounce dots + "Thinking…"。一旦开始输出 token，dots 消失，仅显示流式文本。整个过程没有显示已用时间（elapsed time）、已生成 token 数、或预估剩余时间。

**为什么这是一个问题:** Claude 在流式响应时显示 elapsed time。Cursor 显示 token count。当 AI 思考时间较长（如 deep thinking 模式），用户不知道是在正常工作还是卡住了。Agent trace 虽然显示了步骤，但需要展开才能看到，且不显示总 elapsed time（只在完成后显示）。

**对用户造成的影响:** 长时间响应时用户焦虑，可能误判为卡住而取消。

**优化建议:** (1) 在 streaming 状态下显示 elapsed timer（如 "12s"）；(2) 显示已输出 token 数；(3) Thinking 阶段显示 "Thinking… (8s)"。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 等待焦虑降低

---

### 问题 #024

**问题名称:** Agent Trace Panel 默认折叠，关键信息不可见

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 421-481 行

**问题描述:** AgentTracePanel 默认是折叠状态，只显示一行 summary（图标 + "Agent steps" + 数量 + 总耗时 + 总 token）。用户需要手动点击展开才能看到具体步骤。在 streaming 过程中，trace 也是折叠的，用户无法实时看到 Agent 正在做什么。

**为什么这是一个问题:** Cursor 的 Agent 模式默认展示每一步操作。Claude 的 tool use 在消息流中内联展示。Refora 的 Agent 可能执行搜索、读取论文、生成报告等操作，这些操作的实时反馈对用户理解 Agent 行为至关重要。默认折叠导致用户在等待时完全没有进度反馈。

**对用户造成的影响:** 用户不知道 Agent 当前在做什么，只能看到"Thinking…"。

**优化建议:** (1) streaming 时自动展开 trace panel；(2) 最新步骤自动滚动到可见区域；(3) 或将当前执行步骤提取到消息流中内联显示（类似 Claude 的 tool use indicator）。

**优先级:** High  
**实现复杂度:** Medium  
**预估收益:** Agent 透明度和用户信任度提升

---

### 问题 #025

**问题名称:** Reasoning 展示使用原生 `<details>` 元素，样式不统一

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1477-1488 行

**问题描述:** 流式 reasoning（思考过程）使用 HTML `<details>`/`<summary>` 元素展示，默认 open。样式是简单的 `bg-panel-2 px-3 py-2`，与 AgentTracePanel 的 `rounded-xl border border-border bg-panel-2/80` 风格不一致。reasoning 内容使用 `chat-markdown-muted` class，但与正式响应的 `chat-markdown` 样式略有不同。

**为什么这是一个问题:** Reasoning（思考过程）和 Trace（执行步骤）都是 AI 透明度的重要组成部分，应该有统一的视觉语言。使用原生 `<details>` 无法自定义展开/折叠动画，也与应用的 accordion 模式不一致。

**对用户造成的影响:** 视觉碎片化，reasoning 和 trace 看起来像两个不同的功能。

**优化建议:** (1) 使用自定义可折叠组件替代 `<details>`；(2) 统一 reasoning 和 trace 的视觉风格；(3) 考虑将 reasoning 整合到 trace panel 中作为第一个步骤。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** AI 透明度展示一致性提升

---

### 问题 #026

**问题名称:** Feedback 按钮无实际功能

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1435-1451 行

**问题描述:** 助手消息下方有 ThumbsUp 和 ThumbsDown 按钮，但点击后只是切换本地 `feedback` state（`'up' | 'down' | null`），没有发送任何数据到后端。且 `feedback` state 是组件级别的，切换对话后丢失。每个消息都共享同一个 feedback state，而非每条消息独立。

**为什么这是一个问题:** Feedback 按钮暗示用户可以评价响应质量，但不发送数据是误导性的。ChatGPT 的 feedback 按钮会发送数据用于改进。如果只是 UI 装饰，应该移除；如果是功能占位，应该有 "coming soon" 提示。

**对用户造成的影响:** 用户以为反馈被记录，实际上没有。多消息时 feedback state 混乱（只有最后一条消息能显示选中状态）。

**优化建议:** (1) 如果暂不实现：移除 feedback 按钮，减少 UI 噪音；(2) 如果要实现：每条消息独立存储 feedback，通过 IPC 发送到后端记录。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 消除误导性 UI，或实现有意义的反馈收集

---

### 问题 #027

**问题名称:** Workspace Scope 按钮功能不明确

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1671-1696 行

**问题描述:** 输入区域有一个 "Workspace" 按钮，点击后弹出一个浮层显示 workspace 中的文档列表（只读，不可操作）。这个按钮没有实际功能——它不切换任何 scope、不过滤任何内容、不设置任何参数。用户看到文档列表后无法做任何操作。

**为什么这是一个问题:** 按钮暗示有"作用域"切换功能（如 "chat with all workspace docs" vs "chat with selected docs"），但实际上什么都没做。这是 dead UI，违反了 Don Norman 的 "Affordance" 原则——看起来可以操作的控件实际上不能操作。

**对用户造成的影响:** 用户困惑，点击后无反应，降低信任度。

**优化建议:** (1) 移除该按钮，减少输入区拥挤；(2) 或改为显示当前对话的 context 范围（如 "3 papers in context"），点击可管理 context；(3) 或实现真正的 scope 切换功能。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 消除困惑 UI，输入区简化

---

### 问题 #028

**问题名称:** 缺少消息编辑和分支功能

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx`

**问题描述:** 用户消息发送后不可编辑。如果用户想修改已发送的消息，只能通过 regenerate（删除上一条 user 消息并重新发送）。无法在历史消息基础上创建分支对话。无法编辑后重新发送。

**为什么这是一个问题:** ChatGPT 和 Claude 都支持编辑已发送的用户消息。这是 AI 对话的核心交互之一——用户经常需要微调 prompt。当前只有 regenerate 功能，且 regenerate 是删除后重发，丢失了原始对话分支。

**对用户造成的影响:** prompt 修改效率低，无法对比不同 prompt 的结果。

**优化建议:** (1) 在用户消息 hover 时显示 edit 按钮；(2) 编辑后可选择"发送并创建分支"或"替换当前"；(3) 保留原始响应作为分支。

**优先级:** Low  
**实现复杂度:** Hard  
**预估收益:** 对话灵活性提升

---

### 问题 #029

**问题名称:** Markdown 代码块缺少复制按钮

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx`, `src/renderer/components/workspace/ReportCard.tsx`

**问题描述:** AI 响应中的 Markdown 代码块没有"复制代码"按钮。用户需要手动选择代码文本然后 Cmd+C。整个消息有 CopyButton，但复制的是整条消息的原始 markdown，不是单个代码块。

**为什么这是一个问题:** ChatGPT/Claude/Cursor 的代码块都有 hover 显示的复制按钮。在文献研究场景中，AI 可能生成 BibTeX、代码示例、查询语句等，用户需要快速复制。

**对用户造成的影响:** 代码复制操作繁琐。

**优化建议:** 自定义 ReactMarkdown 的 `code`/`pre` 组件渲染，添加 hover 显示的 copy 按钮。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 代码复制体验改善

---

### 问题 #030

**问题名称:** Token 使用量展示不突出

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 346-352 行, 441-445 行

**问题描述:** Token 使用量只在两个地方显示：(1) 每个 trace step 的 input/output token（用 ↑↓ 箭头 + 数字，字号 `text-label` 11px）；(2) trace panel summary 的总 token 数。在消息流中和输入区域都没有 token 使用提示。用户无法直观看到每次对话消耗了多少 token。

**为什么这是一个问题:** 对于使用付费 API 的用户，token 消耗是重要关注点。ChatGPT 显示每次对话的 token 用量。Cursor 在底部状态栏显示月度用量。当前展示方式太隐蔽（藏在折叠的 trace panel 中）。

**对用户造成的影响:** 用户无法追踪 API 成本。

**优化建议:** (1) 在每条 assistant 消息下方显示该轮对话的 token 总量（小字，如 "1.2k tokens"）；(2) 或在 ChatPanel header 显示当前 thread 累计 token。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** API 成本可追踪性提升

---

### 问题 #031

**问题名称:** Model Selector 下拉菜单信息过载

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` 第 1724-1903 行

**问题描述:** Model Selector 下拉菜单包含 4 个 section：Provider models、Available models（最多 40 个）、Recent（最多 8 个）、Custom model input + Variant selector。在一个 `w-72 max-h-72` 的浮层中塞入这么多内容，信息密度极高。Provider models 和 Available models 可能有重叠。Custom model 输入和 Variant 选择器放在底部，视觉上与列表项混在一起。

**为什么这是一个问题:** Model Selector 是高频操作（每次切换模型都要打开）。Cursor 的 model picker 是简洁的搜索式选择器。当前设计要求用户滚动浏览列表，操作步骤多。

**对用户造成的影响:** 模型切换效率低，新用户容易被大量选项困惑。

**优化建议:** (1) 改为搜索式选择器（顶部搜索框 + 过滤列表）；(2) Provider models 和 Available models 合并去重；(3) Custom model 移到 Settings 或底部 "Advanced" 折叠区；(4) Variant 在选中模型后通过 chip/badge 切换。

**优先级:** Medium  
**实现复杂度:** Medium  
**预估收益:** 模型切换效率提升

---

### 问题 #032

**问题名称:** 多 Workspace 切换时 AI 对话状态管理不透明

**所在页面/模块:** `src/renderer/store/workspaceStore.ts` 第 167-179 行

**问题描述:** 当用户切换 Workspace 时（`setActiveWorkspace`），系统会自动加载新 workspace 的最新 thread。如果当前正在 streaming（`chatStreaming`），切换会被阻止（Sidebar 中 workspace item `disabled={chatStreaming}`）。但如果用户在非 streaming 状态切换，当前对话的未保存输入会丢失。切换后 ChatPanel 的 input 被清空（`setSelectedAttachments([])` 在 `useEffect` 中），没有保存草稿。

**为什么这是一个问题:** 用户可能在输入了一半的 prompt 后不小心切换了 workspace，导致输入丢失。ChatGPT 在切换对话时保留输入草稿。

**对用户造成的影响:** 未完成输入丢失，需要重新输入。

**优化建议:** (1) 按 workspace/thread 保存输入草稿；(2) 切换前如果有未发送输入，显示确认提示。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 输入安全保护

---

## 五、可用性 (Usability)

### 问题 #033

**问题名称:** 删除操作无 Undo 功能

**所在页面/模块:** DocumentList.tsx, DetailPanel.tsx, ConfirmDialog.tsx

**问题描述:** 文档删除通过 ConfirmDialog 确认后执行，PDF 被移到系统 Trash。但没有 Undo 功能——用户如果想恢复，需要去系统 Trash 手动找回。Category 和 Workspace 删除更是不可恢复（没有 Trash 机制）。

**为什么这是一个问题:** Nielsen 的 "User Control and Freedom" 原则要求提供明显的"紧急出口"。Gmail 的删除有 30 天 undo。即使有 ConfirmDialog，用户仍可能误删（特别是批量删除时选错了文档）。

**对用户造成的影响:** 误删后恢复成本高。

**优化建议:** (1) 删除后显示 Toast 带 "Undo" 按钮（5 秒内可撤销）；(2) Category/Workspace 删除使用 soft-delete（标记为 deleted，30 天后清理）。

**优先级:** Medium  
**实现复杂度:** Hard  
**预估收益:** 误操作恢复能力提升

---

### 问题 #034

**问题名称:** 搜索功能不透明——搜索范围未知

**所在页面/模块:** `src/renderer/components/DocumentList.tsx` 第 429-440 行

**问题描述:** DocumentList 顶部的搜索框使用 `performSearch` 函数进行搜索，但 UI 上没有任何提示说明搜索的是什么——是标题？作者？全文？DOI？用户输入后看到结果，但不确定匹配逻辑。搜索也没有高级筛选（如按年份、venue 过滤）。

**为什么这是一个问题:** 用户无法预测搜索结果，降低了搜索的信任度。ChatGPT 的搜索有明确的范围提示。学术文献搜索（如 Google Scholar）通常有字段选择器。

**对用户造成的影响:** 搜索效率降低，用户可能需要多次尝试不同关键词。

**优化建议:** (1) 在搜索框 placeholder 中说明范围（如 "Search title, authors, venue…"）；(2) 搜索结果中高亮匹配的关键词；(3) 考虑添加字段筛选。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 搜索可预测性提升

---

### 问题 #035

**问题名称:** 信息过载——DetailPanel 一次性展示 12 个可编辑字段

**所在页面/模块:** `src/renderer/components/DetailPanel.tsx` 第 21-34 行, 451-461 行

**问题描述:** SingleDetail 组件渲染了 11 个 InlineField（title, authors, year, venue, volume, issue, pages, abstract, keywords, url, doi）+ NoteField + CategoryChips + addedAt + filePath + delete button。这些字段全部平铺在一个 `gap-4` 的 flex-col 中，没有分组。对于很多学术论文，abstract 可能很长，把其他字段推到很下面。

**为什么这是一个问题:** 信息过载导致用户难以快速定位要编辑的字段。Notion/Linear 的属性面板通常有分组（基本信息 / 出版信息 / 自定义）。12 个平铺字段超出了 Miller's Law 的 7±2 认知容量。

**对用户造成的影响:** 字段查找效率低，长 abstract 导致其他字段不可见。

**优化建议:** (1) 将字段分组：Basic (title, authors, year)、Publication (venue, volume, issue, pages)、Content (abstract, keywords, note)、Identifiers (url, doi)；(2) abstract 使用可折叠/高度限制；(3) 空值字段（"—"）可默认折叠。

**优先级:** Medium  
**实现复杂度:** Medium  
**预估收益:** 信息查找效率提升

---

### 问题 #036

**问题名称:** Board 卡片大小不持久化到后端

**所在页面/模块:** `src/renderer/components/workspace/Board.tsx` 第 32 行

**问题描述:** Board 中的 `cardSizes` state 存储在组件内存中，切换 workspace 时会被清空（`useEffect` 在 `activeWorkspaceId` 变化时 `setCardSizes({})`）。用户调整的卡片大小在切换 workspace 后丢失。

**为什么这是一个问题:** 用户调整卡片大小是为了优化阅读体验，丢失调整结果需要重复操作。这违反了 Nielsen 的 "Recognition rather than Recall" 原则——系统应保持用户的状态。

**对用户造成的影响:** 需要重复调整卡片大小，体验差。

**优化建议:** 将 cardSizes 持久化到 settings（按 workspace ID + item ID 存储），或通过 API 存储到 workspace item 的 metadata 中。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 用户状态保持

---

### 问题 #037

**问题名称:** Panel 宽度不持久化

**所在页面/模块:** `src/renderer/App.tsx` 第 45-47 行

**问题描述:** Sidebar width (224px default)、DetailPanel width (384px default)、WorkspacePanel width (480px default) 都存储在组件 state 中，不持久化。重启应用后恢复默认值。只有 `sidebarCollapsed` 和 `workspaceChatHeight` 被持久化。

**为什么这是一个问题:** 用户调整面板宽度是为了适配自己的屏幕和工作流，不持久化导致每次启动都要重新调整。

**对用户造成的影响:** 重复调整面板布局。

**优化建议:** 将所有面板宽度持久化到 settings（与 `sidebarCollapsed` 和 `workspaceChatHeight` 相同的机制）。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 用户体验连续性提升

---

## 六、可访问性 (Accessibility)

### 问题 #038

**问题名称:** 对比度可能不满足 WCAG AA 标准

**所在页面/模块:** `src/renderer/styles/index.css`

**问题描述:** 深色模式中 `--color-muted: #9a9a9a` 在 `--color-panel: #1e1e20` 背景上的对比度约为 3.9:1，低于 WCAG AA 标准要求的 4.5:1（针对正常文本）。大量辅助文本使用 `text-muted`，包括 sidebar 标签、detail 字段标签、chat 时间戳等。`--color-muted` 在 `--color-background: #141416` 上约为 4.0:1，仍然不达标。

浅色模式中 `#6e6e73` 在 `#ffffff` 上约为 4.3:1，也不完全达标。

**为什么这是一个问题:** WCAG AA 是 web 可访问性的基本标准。对比度不足影响视力较弱用户的使用。Apple HIG 要求辅助文本对比度至少 4.5:1。

**对用户造成的影响:** 弱视用户阅读困难，强光环境下辅助文本不可读。

**优化建议:** 深色模式 `--color-muted` 调整为 `#a8a8a8` 或更亮（达到 4.5:1+）；浅色模式调整为 `#5f5f64` 或更暗。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 可访问性合规

---

### 问题 #039

**问题名称:** 大量交互元素缺少 Focus Visible 状态

**所在页面/模块:** 全局

**问题描述:** 虽然 `toolbar-btn`、`sidebar-item`、`sidebar-header-btn` 定义了 `:focus-visible` outline，但大量内联 `<button>` 没有定义。例如：
- ChatPanel 中的 CopyButton (第 487-501 行)
- ChatPanel 中的 feedback 按钮 (第 1430-1460 行)
- DetailPanel 中的 InlineField 编辑触发 (第 152-163 行)
- CategoryChips 中的 unassign 按钮 (第 304-310 行)
- Board 中的卡片操作按钮
- Settings 中的 template 按钮 (第 340-358 行)

**为什么这是一个问题:** WCAG 2.4.7 "Focus Visible" 要求所有交互元素在键盘导航时有可见的 focus 指示。缺少 focus 状态意味着键盘用户无法知道当前焦点位置。

**对用户造成的影响:** 键盘用户无法有效导航。

**优化建议:** 创建全局 `:focus-visible` 样式或 mixin，应用到所有 `<button>`、`[role="button"]`、`<input>`、`<textarea>`、`<select>` 元素。

**优先级:** High  
**实现复杂度:** Easy  
**预估收益:** 键板可访问性合规

---

### 问题 #040

**问题名称:** 动画缺少 `prefers-reduced-motion` 支持

**所在页面/模块:** `src/renderer/styles/index.css` (shimmer, slide-up, trace-fade-in, cat-pulse, thinking-bounce), PaperCard.tsx (motion), ReportCard.tsx (motion)

**问题描述:** 多处动画没有 `prefers-reduced-motion` 媒体查询支持：
- `shimmer` 骨架屏动画
- `slide-up` toast 动画
- `trace-fade-in` trace 步骤动画
- `cat-pulse` 分类拖放脉冲
- `thinking-bounce` AI thinking dots
- PaperCard/ReportCard 的 `motion.div` 入场动画

**为什么这是一个问题:** WCAG 2.3.3 "Animation from Interactions" 要求尊重用户的 `prefers-reduced-motion` 系统设置。前庭功能障碍用户可能因动画产生不适。

**对用户造成的影响:** 前庭功能障碍用户体验不适。

**优化建议:** 添加全局 `@media (prefers-reduced-motion: reduce)` 规则，禁用或简化所有动画。motion 库可通过 `MotionConfig` 设置 `reducedMotion="user"`。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 可访问性合规

---

### 问题 #041

**问题名称:** ARIA 标签不完善

**所在页面/模块:** 全局

**问题描述:** 多处缺少或不正确的 ARIA 属性：
- ChatPanel streaming 区域有 `aria-live="polite"`（正确），但错误消息区域没有 `role="alert"`
- Board 的 drag-drop 区域没有 `aria-label` 说明可拖放
- ResizeDivider 有 `role="separator"` 和 `aria-orientation`（正确），但没有 `aria-valuenow`/`aria-valuemax`/`aria-valuemin`
- CategoryChips 的 "+" 按钮没有 `aria-label`
- ChatPanel thread menu 中的 rename/delete 按钮有 `title` 但没有 `aria-label`（title 不够）
- DocumentList 的列头排序没有 `aria-sort` 属性

**为什么这是一个问题:** 屏幕阅读器依赖 ARIA 属性理解页面结构和状态。缺少 ARIA 导致屏幕阅读器用户无法有效使用应用。

**对用户造成的影响:** 视障用户使用屏幕阅读器时信息缺失。

**优化建议:** 系统性审计并补充 ARIA 属性：`aria-label`、`aria-sort`、`role="alert"`、`aria-live` 等。

**优先级:** Medium  
**实现复杂度:** Medium  
**预估收益:** 屏幕阅读器可访问性提升

---

## 七、前端实现角度

### 问题 #042

**问题名称:** Color Token 定义了两处——CSS 变量和 Antd Token Overrides

**所在页面/模块:** `src/renderer/styles/index.css` (CSS 变量), `src/renderer/App.tsx` 第 53-79 行 (antd tokenOverrides)

**问题描述:** 颜色值被硬编码在两处：CSS 变量中定义（如 `#1f7ae0` for accent in dark）和 App.tsx 的 `tokenOverrides` 中（如 `colorPrimary: '#1f7ae0'`）。两处需要手动保持同步。如果只改了一处，Tailwind 组件和 Antd 组件会出现颜色不一致。

**为什么这是一个问题:** Single Source of Truth 原则违反。设计 Token 应该在一处定义，多处消费。当前架构需要开发者记住改两处。

**对用户造成的影响:** 潜在的颜色不一致。

**优化建议:** 让 Antd Token Overrides 引用 CSS 变量值（如 `colorPrimary: 'var(--color-accent)'`），或在 JS 中读取 CSS 变量。

**优先级:** Medium  
**实现复杂度:** Medium  
**预估收益:** 单一数据源，维护成本降低

---

### 问题 #043

**问题名称:** Markdown 渲染配置重复定义

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx` (第 65-66 行, 100-126 行), `src/renderer/components/workspace/ReportCard.tsx` (第 16-17 行, 19-25 行)

**问题描述:** REMARK_PLUGINS、REHYPE_PLUGINS 和 MARKDOWN_COMPONENTS 在 ChatPanel 和 ReportCard 中分别定义。ChatPanel 的 MARKDOWN_COMPONENTS 有自定义 `a` 渲染（支持 `refora://` 链接），ReportCard 的只是简单 `target="_blank"`。两者都 import 了相同的 `remark-gfm`、`remark-math`、`rehype-katex` 和 `katex/dist/katex.min.css`。

**为什么这是一个问题:** DRY 违反。插件配置和组件映射应该统一管理，避免不一致。如果需要修改 markdown 渲染行为（如添加代码块复制按钮），需要改两处。

**对用户造成的影响:** 无直接影响，但维护成本高。

**优化建议:** 创建共享的 markdown 配置模块 `src/renderer/utils/markdown.ts`，导出统一的 plugins 和 components。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 代码复用，维护成本降低

---

### 问题 #044

**问题名称:** 缺少统一的 Spacing Token

**所在页面/模块:** 全局

**问题描述:** 应用使用 Tailwind 的默认 spacing scale，但使用不规律：`gap-0.5` (2px)、`gap-1` (4px)、`gap-1.5` (6px)、`gap-2` (8px)、`gap-3` (12px)、`gap-4` (16px)、`px-1` (4px)、`px-2` (8px)、`px-2.5` (10px)、`px-3` (12px)、`px-5` (20px)、`py-0.5` (2px)、`py-1` (4px)、`py-1.5` (6px)、`py-2` (8px)、`py-4` (16px)。没有文档说明何时用哪个间距值。`sidebar-inset` (8px) 是唯一定义的 spacing token。

**为什么这是一个问题:** Spacing 是视觉节奏的基础。Linear/Vercel 都有严格的 4px/8px grid。当前 `px-2.5` (10px)、`py-1.5` (6px)、`gap-1.5` (6px) 不在 4px grid 上，导致视觉节奏不均匀。

**对用户造成的影响:** 微妙的视觉节奏不一致。

**优化建议:** 定义语义化 spacing token：`space-xs` (4px)、`space-sm` (8px)、`space-md` (12px)、`space-lg` (16px)、`space-xl` (24px)。消除非 4px grid 的值（6px → 8px, 10px → 8px or 12px）。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 视觉节奏统一

---

### 问题 #045

**问题名称:** `doc-search-input` CSS Hack 使用 `!important`

**所在页面/模块:** `src/renderer/styles/index.css` 第 189-206 行

**问题描述:** 为了让 LobeHub Input 在浅色模式下可见，使用了 6 条 `!important` 规则来覆盖 antd 的 `colorBorderSecondary` token。注释说明了原因：lobehub Input `outlined` variant 使用 antd 的 `colorBorderSecondary`（浅色模式下为 #e5e5ea），在浅色工具栏上几乎不可见。

**为什么这是一个问题:** `!important` 是 CSS 中的"核武器"，使样式难以被覆盖和维护。根本问题是 LobeHub Input 的默认 token 与应用的 CSS 变量体系不一致。如果 LobeHub 更新了组件样式，这些 override 可能失效。

**对用户造成的影响:** 当前无直接影响，但存在样式回归风险。

**优化建议:** (1) 通过 antd ConfigProvider 的 `token` 配置 `colorBorderSecondary` 而非 CSS override；(2) 或使用自建 Input 组件替代 LobeHub Input 用于搜索框。

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 消除脆弱的 CSS hack

---

### 问题 #046

**问题名称:** 缺少统一的 Design System 组件层

**所在页面/模块:** 全局

**问题描述:** 应用没有统一的 Design System 组件库。以下组件在多处重复实现：
- **Button**: 7 种实现方式（见问题 #005）
- **Input**: LobeHub Input、antd Input、原生 `<input>`、原生 `<textarea>`、`.field-input` CSS 类、`.search-input` CSS 类
- **Card**: `.card` CSS 类、PaperCard 内联样式、ReportCard 内联样式
- **Badge**: PaperCard 中的 `Badge` 组件（局部）、Settings 中的 inline badge（多处）
- **Tooltip**: 全部使用原生 `title` 属性，无自定义 tooltip 组件
- **Dropdown/Popover**: 手动实现的 `useEffect` + `document.addEventListener('mousedown')` 模式（ChatPanel 中有 5 处：modelMenu、threadMenu、attachMenu、workspaceScope、modelSwitchHint）
- **Confirm Dialog**: 4 种实现（见问题 #014）
- **Toast**: 3 处重复（见问题 #015）
- **Empty State**: 3 处独立实现（见问题 #018）

**为什么这是一个问题:** 组件复用是前端工程的基础。重复实现导致行为不一致（如 5 处 popover 的关闭逻辑各自独立实现，可能遗漏 edge case）。新增功能时开发者需要"选择"用哪种实现，增加了认知负担。

**对用户造成的影响:** 交互行为不一致（如不同 popover 的关闭行为可能不同）。

**优化建议:** 建立 `src/renderer/components/ui/` 目录，包含统一的 `Button`、`Input`、`Card`、`Badge`、`Tooltip`、`Popover`、`ConfirmDialog`、`Toast`、`EmptyState` 组件。所有业务组件只使用这些 UI 基础组件。

**优先级:** Critical  
**实现复杂度:** Hard  
**预估收益:** 代码复用率大幅提升，交互一致性保证，开发效率提升

---

### 问题 #047

**问题名称:** Popover/Dropdown 关闭逻辑重复实现 5 次

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx`

**问题描述:** ChatPanel 中有 5 个弹出层，每个都使用相同的模式手动实现"点击外部关闭"逻辑：
1. `modelMenuOpen` (第 859-867 行)
2. `threadMenuOpen` (第 874-882 行)
3. `attachMenuOpen` (第 885-893 行)
4. `workspaceScopeOpen` (第 914-923 行)
5. `confirmDeleteThread` 使用 dialog-overlay (不需要此逻辑)

每个都是 `useEffect` + `document.addEventListener('mousedown')` + `ref.contains(e.target)` 检查。

**为什么这是一个问题:** 相同逻辑重复 4 次。如果需要添加 Escape 键关闭（当前只有 modelMenu 有），需要改 4 处。这种模式容易出错（如遗漏 cleanup）。

**对用户造成的影响:** 不同弹出层的键盘交互可能不一致。

**优化建议:** 创建 `useClickOutside(ref, onClose)` hook 或使用 Headless UI 的 `Popover` 组件（项目已安装 `@headlessui/react`）。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 代码量减少 ~60 行，行为统一

---

### 问题 #048

**问题名称:** 未使用已安装的 Headless UI 库

**所在页面/模块:** `package.json` (第 21 行: `"@headlessui/react": "^2.1.3"`)

**问题描述:** 项目安装了 `@headlessui/react`（Headless UI v2），但在代码中完全没有使用。所有 Popover、Dialog、Menu 都是手动实现的。Headless UI 提供了完善的 `Popover`、`Dialog`、`Menu`、`Listbox` 组件，自带焦点管理、键盘导航、ARIA 属性。

**为什么这是一个问题:** 安装了优秀的无障碍组件库却不用，反而手动实现有可访问性问题的替代品。Headless UI 的 `Dialog` 自带 focus trap、`Popover` 自带 click outside 关闭和 Escape 支持。

**对用户造成的影响:** 可访问性和键盘交互不如使用 Headless UI 的实现。

**优化建议:** 逐步将手动实现的 Popover/Dialog/Menu 替换为 Headless UI 组件。特别是 ChatPanel 中的 4 个弹出层和所有 confirm dialog。

**优先级:** Medium  
**实现复杂度:** Medium  
**预估收益:** 可访问性提升，代码量减少

---

### 问题 #049

**问题名称:** Sidebar 组件过于庞大（850 行）

**所在页面/模块:** `src/renderer/components/Sidebar.tsx`

**问题描述:** Sidebar.tsx 有 850 行代码，包含：
- SidebarItem 子组件
- SidebarSection 子组件
- Sidebar 主组件，管理：categories CRUD、workspaces CRUD、theme toggle、import progress、settings modal、drag-drop、context menus
- 2 个内联 delete confirmation dialog

一个文件承担了太多职责。

**为什么是一个问题:** 单一职责原则违反。850 行的组件难以维护、难以测试。Category 管理、Workspace 管理、Footer 操作应该分离。

**对用户造成的影响:** 无直接影响，但开发维护效率低。

**优化建议:** 拆分为：
- `Sidebar.tsx` - 布局容器
- `SidebarSmartItems.tsx` - All Files / Recent / Starred
- `SidebarWorkspaces.tsx` - Workspace 列表管理
- `SidebarCategories.tsx` - Category 列表管理
- `SidebarFooter.tsx` - Settings / Export / Theme

**优先级:** Low  
**实现复杂度:** Medium  
**预估收益:** 代码可维护性提升

---

### 问题 #050

**问题名称:** ChatPanel 组件过于庞大（2000 行）

**所在页面/模块:** `src/renderer/components/workspace/ChatPanel.tsx`

**问题描述:** ChatPanel.tsx 有 2000 行代码，包含：
- StreamingMarkdown 子组件
- CopyButton 子组件
- TraceStepRow 子组件
- AgentTracePanel 子组件
- ChatPanel 主组件，管理：消息流、streaming、reasoning、traces、model selector、attachments、workspace scope、thread history、error handling、keyboard shortcuts
- 1 个内联 delete confirmation dialog

主组件有 ~40 个 useState/useRef，~30 个 useEffect/useCallback/useMemo。

**为什么这是一个问题:** 2000 行的组件是维护噩梦。状态管理极其复杂，任何修改都有引入 bug 的风险。React DevTools 中难以追踪状态变化。

**对用户造成的影响:** 无直接影响，但功能迭代速度会越来越慢。

**优化建议:** 拆分为：
- `ChatPanel.tsx` - 布局容器
- `ChatMessages.tsx` - 消息流渲染
- `ChatInput.tsx` - 输入区域 + 附件 + workspace scope
- `ModelSelector.tsx` - 模型选择器
- `ThreadHistory.tsx` - 对话历史
- `AgentTrace.tsx` - Trace 面板（已有部分子组件）
- `useChatStream.ts` - streaming 逻辑 hook
- `useModelSelector.ts` - 模型选择逻辑 hook

**优先级:** Medium  
**实现复杂度:** Hard  
**预估收益:** 代码可维护性大幅提升

---

### 问题 #051

**问题名称:** `window.prompt` 用于创建分类

**所在页面/模块:** `src/renderer/components/DocumentList.tsx` 第 248-253 行

**问题描述:** `createAndAssign` 函数使用 `window.prompt()` 弹出浏览器原生 prompt 来输入分类名称。这与应用其他地方的 inline input 模式（Sidebar 中的 category 创建使用 inline Input）不一致。

**为什么这是一个问题:** Electron 中的 `window.prompt` 在不同平台表现不同，且无法自定义样式。应用其他地方已经实现了 inline input 模式，这里应该保持一致。

**对用户造成的影响:** 右键菜单创建分类时弹出系统原生对话框，体验突兀。

**优化建议:** 使用 context menu 中的 inline input 或弹出自定义 dialog。

**优先级:** Low  
**实现复杂度:** Easy  
**预估收益:** 交互一致性提升

---

### 问题 #052

**问题名称:** 错误处理使用 `void 0` 吞掉异常

**所在页面/模块:** Sidebar.tsx (多处), DocumentList.tsx, Board.tsx

**问题描述:** 多处 catch 块使用 `void 0` 或空函数吞掉错误：
- `Sidebar.tsx:131` - `catch { void 0 }`
- `Sidebar.tsx:139` - `catch { void 0 }`
- `Sidebar.tsx:335` - `catch { void 0 }`
- `Sidebar.tsx:369` - `catch { void 0 }`
- `DocumentList.tsx:347` - `catch { void 0 }`
- `DocumentList.tsx:353` - `catch { void 0 }`
- `Board.tsx:192` - `console.warn`
- `Board.tsx:210` - `console.warn`

**为什么这是一个问题:** 静默吞掉错误意味着用户操作失败时没有任何反馈。如果导入文件失败、拖放分类失败，用户不知道发生了什么。AGENTS.md 明确要求"IPC handlers never throw across the bridge (wrap in try/catch, always resolve)"，但 renderer 侧也应该给用户错误反馈。

**对用户造成的影响:** 操作失败时无反馈，用户以为操作成功了。

**优化建议:** 在 catch 块中调用 `showToast(errorMessage(e, '操作失败描述'))` 给用户反馈。

**优先级:** Medium  
**实现复杂度:** Easy  
**预估收益:** 错误反馈改善

---

## Implementation Plan

### Phase 1: Critical - Design System Foundation

> 目标: 建立统一的 Design System 基础层，为后续所有优化奠定基础

---

#### Task DS-01: 创建统一 Button 组件

- **Task ID:** DS-01
- **标题:** 创建统一 Button 组件替代 7 种按钮实现
- **修改目标:** 建立单一 Button 组件，支持 primary/secondary/ghost/danger/link 变体和 sm/md/lg 尺寸
- **涉及页面:** 全局
- **涉及组件:** 新建 `src/renderer/components/ui/Button.tsx`；修改 Sidebar.tsx, DocumentList.tsx, DetailPanel.tsx, ChatPanel.tsx, SettingsModal.tsx, FirstRunWizard.tsx, ConfirmDialog.tsx
- **修改步骤:**
  1. 创建 `src/renderer/components/ui/Button.tsx`，定义 variant (primary | secondary | ghost | danger | link) 和 size (sm | md | lg) props
  2. 使用 Tailwind class + CSS 变量实现样式，映射到 `--color-accent`、`--color-panel` 等 token
  3. 内置 `focus-visible` outline、disabled 状态、loading 状态
  4. 支持 `icon` prop（left icon）和 `iconOnly` 模式
  5. 逐个替换现有 7 种按钮实现：
     - `.toolbar-btn` → `<Button variant="ghost" size="md">`
     - `.sidebar-header-btn` → `<Button variant="ghost" size="sm" iconOnly>`
     - 内联 `<button className="bg-accent...">` → `<Button variant="primary">`
     - antd/LobeHub `<Button>` → 逐步替换（保留 antd Modal footer 中的 Button 暂时不动）
  6. 保留 CSS 类作为向后兼容，标记 `@deprecated`
- **验收标准:**
  - 所有按钮使用统一 `<Button>` 组件
  - `npm run typecheck && npm run lint && npm run test` 通过
  - 按钮在 dark/light 模式下视觉一致
  - 所有按钮有 focus-visible 状态
- **是否可独立完成:** 是
- **推荐提交顺序:** 1（基础组件，其他 Task 依赖）
- **推荐 Commit Message:** `feat(ui): add unified Button component with variant system`

---

#### Task DS-02: 创建统一 Input 组件

- **Task ID:** DS-02
- **标题:** 创建统一 Input/Textarea 组件
- **修改目标:** 替代 LobeHub Input、antd Input、原生 input/textarea、`.field-input`、`.search-input` 等多种实现
- **涉及页面:** 全局
- **涉及组件:** 新建 `src/renderer/components/ui/Input.tsx`；修改 DocumentList.tsx, DetailPanel.tsx, SettingsModal.tsx, Sidebar.tsx, ChatPanel.tsx
- **修改步骤:**
  1. 创建 `Input` 组件，支持 variant (outlined | filled | borderless)、size (sm | md)、error 状态
  2. 创建 `Textarea` 组件，支持 autoResize prop
  3. 使用 CSS 变量确保 dark/light 模式一致
  4. 内置 focus ring、placeholder 样式
  5. 替换 `.search-input`、`.field-input`、LobeHub `<Input>`（搜索框等场景）
  6. 消除 `doc-search-input` CSS hack（index.css:189-206）
- **验收标准:**
  - 所有文本输入使用统一组件
  - `doc-search-input` CSS hack 被移除
  - 输入框在 dark/light 模式下边框/背景一致
  - typecheck/lint/test 通过
- **是否可独立完成:** 是（但建议在 DS-01 之后）
- **推荐提交顺序:** 2
- **推荐 Commit Message:** `feat(ui): add unified Input and Textarea components`

---

#### Task DS-03: 创建统一 Card 和 Badge 组件

- **Task ID:** DS-03
- **标题:** 创建统一 Card 和 Badge 组件
- **修改目标:** 统一卡片和标签样式
- **涉及页面:** PaperCard, ReportCard, SettingsModal, DetailPanel
- **涉及组件:** 新建 `src/renderer/components/ui/Card.tsx`、`src/renderer/components/ui/Badge.tsx`
- **修改步骤:**
  1. 创建 `Card` 组件：支持 variant (default | elevated | outlined)、hoverable prop
  2. 创建 `Badge` 组件：支持 variant (default | accent | success | warning | error)、size
  3. PaperCard 使用 `<Card hoverable>` 替代 `.card` class
  4. ReportCard 统一为相同 Card 样式，左 accent 条改为 Badge 或图标
  5. Settings 中的 inline badge 统一使用 `<Badge>` 组件
  6. PaperCard 中的局部 `Badge` 组件移除，使用全局 Badge
- **验收标准:**
  - Board 中 PaperCard 和 ReportCard 视觉风格统一
  - Badge 样式全局一致
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 3
- **推荐 Commit Message:** `feat(ui): add unified Card and Badge components`

---

#### Task DS-04: 统一 Color Token 数据源

- **Task ID:** DS-04
- **标题:** 消除 Color Token 重复定义，实现单一数据源
- **修改目标:** Antd Token Overrides 引用 CSS 变量，而非硬编码颜色值
- **涉及页面:** App.tsx, index.css
- **涉及组件:** App.tsx
- **修改步骤:**
  1. 在 App.tsx 中使用 `getComputedStyle(document.documentElement).getPropertyValue('--color-accent')` 读取 CSS 变量
  2. 或直接在 tokenOverrides 中使用 `'var(--color-accent)'` 字符串（Antd 支持 CSS 变量值）
  3. 删除 tokenOverrides 中的硬编码颜色值
  4. 同时修复 index.css 中重复的 `--color-success` 定义
  5. 确保 ThemeProvider 切换主题时 Antd 组件颜色同步更新
- **验收标准:**
  - 颜色值只在 index.css CSS 变量中定义
  - 修改 CSS 变量后 Antd 组件颜色同步变化
  - `--color-success` 重复定义被移除
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 4
- **推荐 Commit Message:** `refactor(ui): unify color tokens to single source of truth`

---

### Phase 2: High Priority - UX Critical Fixes

---

#### Task UX-01: 提取全局 Toast 组件

- **Task ID:** UX-01
- **标题:** 提取全局 Toast 组件，消除 3 处重复
- **修改目标:** Toast 在 App.tsx 层全局渲染一次
- **涉及页面:** App.tsx, DetailPanel.tsx
- **涉及组件:** 新建 `src/renderer/components/ui/Toast.tsx`；修改 App.tsx, DetailPanel.tsx
- **修改步骤:**
  1. 创建 `Toast` 组件，订阅 `documentStore.toastMessage`
  2. 在 App.tsx 中渲染 `<Toast />`（在所有面板之上）
  3. 从 DetailPanel 的三个分支中删除重复的 Toast 代码（第 632-638, 659-665, 683-689 行）
  4. Toast 支持 auto-dismiss（已有 `toastTimeout` 逻辑在 documentStore）
  5. Toast 位置改为 `fixed bottom-5 left-1/2 -translate-x-1/2`（居中更醒目）
- **验收标准:**
  - Toast 在任意操作触发时全局显示
  - DetailPanel 中无 Toast 代码
  - Toast 位置和动画全局一致
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 5
- **推荐 Commit Message:** `feat(ui): extract global Toast component`

---

#### Task UX-02: 统一 Confirm Dialog

- **Task ID:** UX-02
- **标题:** 统一所有删除确认对话框到共享 ConfirmDialog
- **修改目标:** 消除 4 种删除确认实现，统一使用 ConfirmDialog
- **涉及页面:** Sidebar.tsx, ChatPanel.tsx, ConfirmDialog.tsx
- **涉及组件:** 修改 ConfirmDialog.tsx, Sidebar.tsx, ChatPanel.tsx
- **修改步骤:**
  1. 扩展 ConfirmDialog 为通用 confirm store（在 documentStore 或新建 confirmStore）
  2. 支持自定义 title、message、confirmText、cancelText、danger 等参数
  3. Sidebar 中 Category 删除确认（第 803-823 行）改为调用 `confirmStore.request({ ... })`
  4. Sidebar 中 Workspace 删除确认（第 825-845 行）改为调用 `confirmStore.request({ ... })`
  5. ChatPanel 中 Thread 删除确认（第 1969-1997 行）改为调用 `confirmStore.request({ ... })`
  6. 删除三处内联 dialog-overlay/dialog-panel 代码
- **验收标准:**
  - 所有删除确认使用 ConfirmDialog
  - 无内联 dialog-overlay 代码（除 FirstRunWizard 的全屏 dialog）
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 6
- **推荐 Commit Message:** `refactor(ui): unify confirm dialogs to shared ConfirmDialog component`

---

#### Task UX-03: 优化 ChatPanel Header 显示

- **Task ID:** UX-03
- **标题:** ChatPanel Header 显示当前对话标题而非静态"Chat"
- **修改目标:** Header 中间显示当前 thread 标题或 workspace 名称
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** ChatPanel.tsx
- **修改步骤:**
  1. 从 `useWorkspaceStore` 获取当前 thread 的 title
  2. Header 中间显示：有 active thread → thread title (truncate)；无 thread → "New conversation"
  3. 标题可点击触发 thread menu（替代左侧的 MessageSquare 按钮，或保留按钮但标题也可点击）
  4. 如果 thread title 很长，使用 truncate 并在 hover 时显示完整 title
- **验收标准:**
  - Header 显示有意义的标题信息
  - 切换对话时标题更新
  - 长标题正确截断
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 7
- **推荐 Commit Message:** `feat(chat): show conversation title in ChatPanel header`

---

#### Task UX-04: 优化 DetailPanel Header 空间利用

- **Task ID:** UX-04
- **标题:** DetailPanel Header 高度降低并提取共享组件
- **修改目标:** 将 48px header 降至 36px，左侧显示文档标题
- **涉及页面:** DetailPanel.tsx
- **涉及组件:** 新建 `src/renderer/components/ui/PanelHeader.tsx`；修改 DetailPanel.tsx
- **修改步骤:**
  1. 创建 `PanelHeader` 组件：props { title, onClose, actions }
  2. 高度 36px，左侧 truncate 显示 title，右侧 close button
  3. DetailPanel 三个分支使用 `<PanelHeader>`
  4. SingleDetail 传入文档标题作为 title
  5. BulkBar 传入 "{{count}} selected" 作为 title
  6. 空状态传入空字符串或省略 title
- **验收标准:**
  - DetailPanel header 高度 36px
  - header 显示文档标题或选中计数
  - 三个分支使用统一 PanelHeader
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 8
- **推荐 Commit Message:** `feat(ui): add PanelHeader component and optimize DetailPanel header`

---

#### Task UX-05: 提取共享 Popover Hook

- **Task ID:** UX-05
- **标题:** 提取 useClickOutside hook，消除 4 处重复
- **修改目标:** 统一 ChatPanel 中 4 处 popover 关闭逻辑
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** 新建 `src/renderer/hooks/useClickOutside.ts`；修改 ChatPanel.tsx
- **修改步骤:**
  1. 创建 `useClickOutside(ref, onClose, isActive)` hook
  2. 内部实现 `document.addEventListener('mousedown')` + `ref.contains` 检查
  3. 同时支持 Escape 键关闭
  4. ChatPanel 中 modelMenu、threadMenu、attachMenu、workspaceScope 4 处替换为 `useClickOutside`
  5. 删除 4 个重复的 useEffect 块
- **验收标准:**
  - 4 处 popover 使用统一 hook
  - 所有 popover 支持 Escape 键关闭
  - 点击外部正确关闭
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 9
- **推荐 Commit Message:** `refactor(hooks): extract useClickOutside hook for popover management`

---

#### Task UX-06: Agent Trace Panel streaming 时自动展开

- **Task ID:** UX-06
- **标题:** Streaming 时自动展开 Agent Trace Panel
- **修改目标:** 用户在等待 AI 响应时能看到 Agent 执行步骤
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** ChatPanel.tsx (AgentTracePanel)
- **修改步骤:**
  1. AgentTracePanel 接收 `streaming` prop（已有）
  2. 当 `streaming === true` 且 `visible.length > 0` 时，设置 `open` 为 true
  3. 使用 `useEffect` 在 `streaming` 变化时自动设置 `open`
  4. streaming 结束后保持当前展开状态（不自动折叠）
  5. 最新执行中的步骤自动滚动到可见区域
- **验收标准:**
  - streaming 开始后 trace panel 自动展开
  - 用户能看到 Agent 当前执行的步骤
  - streaming 结束后不自动折叠
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 10
- **推荐 Commit Message:** `feat(chat): auto-expand agent trace during streaming`

---

#### Task UX-07: 添加 Streaming Elapsed Timer

- **Task ID:** UX-07
- **标题:** Streaming 时显示已用时间
- **修改目标:** 在 thinking dots 旁显示 elapsed time
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** ChatPanel.tsx
- **修改步骤:**
  1. 添加 `streamingStartTime` state，在 streaming 开始时记录 `Date.now()`
  2. 使用 `setInterval` 每秒更新 `elapsedSeconds`
  3. 在 thinking dots 区域显示：`Thinking… (8s)` 或 `Thinking… (1m 12s)`
  4. streaming 结束后清除 timer
  5. 在流式文本区域底部也显示 elapsed time（小字）
- **验收标准:**
  - streaming 时显示实时计时
  - 计时格式：< 60s 显示 "Xs"，≥ 60s 显示 "Xm Ys"
  - streaming 结束后计时消失
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 11
- **推荐 Commit Message:** `feat(chat): show elapsed time during streaming`

---

#### Task UX-08: 改进 Empty State 设计

- **Task ID:** UX-08
- **标题:** 为所有 Empty State 添加图标和 CTA
- **修改目标:** 提升新用户引导
- **涉及页面:** DocumentList.tsx, Board.tsx, DetailPanel.tsx
- **涉及组件:** 新建 `src/renderer/components/ui/EmptyState.tsx`；修改上述组件
- **修改步骤:**
  1. 创建 `EmptyState` 组件：props { icon, title, description, action }
  2. DocumentList 空库状态：FileText 图标 + "Your library is empty" + "Add PDF" 按钮
  3. DocumentList 无搜索结果：Search 图标 + "No documents match your search" + "Clear search" 按钮
  4. Board 空状态：拖拽示意图 + "Drag papers here" + "or browse library" 提示
  5. DetailPanel 空状态：FileText 图标 + "Select a document to view details"
- **验收标准:**
  - 所有 Empty State 有图标、标题、描述
  - 有明确可操作的 CTA（如适用）
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 12
- **推荐 Commit Message:** `feat(ui): improve empty states with icons and CTAs`

---

#### Task UX-09: 全局 Focus Visible 状态

- **Task ID:** UX-09
- **标题:** 为所有交互元素添加 focus-visible 状态
- **修改目标:** WCAG 2.4.7 合规
- **涉及页面:** 全局
- **涉及组件:** index.css, 所有包含 `<button>` 的组件
- **修改步骤:**
  1. 在 index.css 中添加全局规则：
     ```css
     button:focus-visible,
     [role="button"]:focus-visible,
     a:focus-visible,
     input:focus-visible,
     textarea:focus-visible,
     select:focus-visible {
       outline: 2px solid var(--color-accent);
       outline-offset: 2px;
     }
     ```
  2. 移除各组件中重复的 `:focus-visible` 定义（toolbar-btn、sidebar-item 等已有）
  3. 检查所有内联 `<button>` 确保有 focus 样式
- **验收标准:**
  - Tab 键导航时所有交互元素显示 focus outline
  - 鼠标点击不触发 outline（使用 `:focus-visible` 而非 `:focus`）
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 13
- **推荐 Commit Message:** `fix(a11y): add global focus-visible styles for keyboard navigation`

---

### Phase 3: Medium Priority - Interaction & AI UX Polish

---

#### Task UX-10: 简化 ChatPanel 输入区域

- **Task ID:** UX-10
- **标题:** 将 Model Selector 和 Deep Thinking 移到 header/popover
- **修改目标:** 输入区域只保留 textarea + attach + send
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** ChatPanel.tsx
- **修改步骤:**
  1. 将 model selector 移到 ChatPanel header 右侧（compact 显示，点击展开 popover）
  2. Deep thinking toggle 移到 header 右侧或 model selector popover 内
  3. Workspace scope 按钮移除（见 UX-11）或改为 inline chip
  4. 输入区域底部只保留：attach button (左) + send/stop button (右)
  5. 字符计数保留在 textarea 右下角（仅超 80% 时显示）
- **验收标准:**
  - 输入区域视觉简洁
  - Model selector 在 header 可访问
  - 所有功能保留，无功能丢失
  - typecheck/lint/test 通过
- **是否可独立完成:** 是（建议在 UX-03 之后）
- **推荐提交顺序:** 14
- **推荐 Commit Message:** `refactor(chat): simplify input area by moving controls to header`

---

#### Task UX-11: 移除无功能的 Workspace Scope 按钮

- **Task ID:** UX-11
- **标题:** 移除 Workspace Scope 按钮或实现真正功能
- **修改目标:** 消除 dead UI
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** ChatPanel.tsx
- **修改步骤:**
  1. 移除 `workspaceScopeOpen` state 和相关 useEffect
  2. 移除 workspace scope button 和 popover 代码
  3. 移除 `workspaceScopeRef` ref
  4. 清理相关 i18n key（如不再使用）
  5. 或：改为显示 "N papers in context" 的只读 badge（不可点击）
- **验收标准:**
  - 无功能的按钮被移除
  - 输入区域更简洁
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 15
- **推荐 Commit Message:** `fix(chat): remove non-functional workspace scope button`

---

#### Task UX-12: 移除或实现 Feedback 按钮

- **Task ID:** UX-12
- **标题:** 处理无后端支持的 Feedback 按钮
- **修改目标:** 消除误导性 UI
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** ChatPanel.tsx
- **修改步骤:**
  1. 方案 A（推荐）：移除 ThumbsUp/ThumbsDown 按钮，减少 UI 噪音
  2. 方案 B：将 feedback 存储到本地（每条消息独立），并通过 IPC 持久化
  3. 删除 `feedback` state
  4. 清理相关 i18n key
- **验收标准:**
  - 无误导性 UI
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 16
- **推荐 Commit Message:** `fix(chat): remove non-functional feedback buttons`

---

#### Task UX-13: 统一 Category 选择 UI

- **Task ID:** UX-13
- **标题:** 用 LobeHub Select 或 ContextMenu 替代原生 `<select>`
- **修改目标:** 消除原生 select 元素
- **涉及页面:** DetailPanel.tsx (CategoryChips, BulkBar)
- **涉及组件:** DetailPanel.tsx
- **修改步骤:**
  1. CategoryChips 的 "+" 按钮改为弹出 context menu 列出可选分类
  2. BulkBar 的 category select 改为 LobeHub `<Select>` 组件
  3. 移除原生 `<select>` 元素
  4. 确保样式与应用一致
- **验收标准:**
  - 无原生 `<select>` 元素
  - 分类选择 UI 样式统一
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 17
- **推荐 Commit Message:** `refactor(ui): replace native select with unified component`

---

#### Task UX-14: DocumentList Checkbox 点击区域增大

- **Task ID:** UX-14
- **标题:** 增大文档列表 checkbox 和可点击区域
- **修改目标:** 提升多选操作效率
- **涉及页面:** DocumentList.tsx
- **涉及组件:** DocumentList.tsx
- **修改步骤:**
  1. Checkbox 尺寸从 `h-3 w-3` (12px) 改为 `h-4 w-4` (16px)
  2. Checkbox 列宽从 `w-8` (32px) 改为 `w-10` (40px)
  3. 整个 checkbox 列容器点击都触发 toggle（已有 `onClick` stopPropagation）
  4. SkeletonRows 中的占位宽度同步调整
- **验收标准:**
  - Checkbox 更容易点击
  - 列宽协调调整
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 18
- **推荐 Commit Message:** `fix(ux): enlarge checkbox click target in document list`

---

#### Task UX-15: 修复对比度问题

- **Task ID:** UX-15
- **标题:** 调整 muted 颜色满足 WCAG AA 对比度
- **修改目标:** 辅助文本对比度 ≥ 4.5:1
- **涉及页面:** index.css
- **涉及组件:** index.css
- **修改步骤:**
  1. 深色模式：`--color-muted` 从 `#9a9a9a` 调整为 `#a8a8a8`（在 `#1e1e20` 上对比度 ~4.7:1）
  2. 浅色模式：`--color-muted` 从 `#6e6e73` 调整为 `#5f5f64`（在 `#ffffff` 上对比度 ~5.2:1）
  3. 在 `#141416` background 上验证对比度
  4. 检查 `--color-border` 在浅色模式下的可见性
- **验收标准:**
  - 所有 `text-muted` 文本对比度 ≥ 4.5:1
  - 使用对比度检查工具验证
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 19
- **推荐 Commit Message:** `fix(a11y): adjust muted color for WCAG AA contrast compliance`

---

#### Task UX-16: 添加 prefers-reduced-motion 支持

- **Task ID:** UX-16
- **标题:** 为所有动画添加 reduced motion 支持
- **修改目标:** WCAG 2.3.3 合规
- **涉及页面:** index.css, PaperCard.tsx, ReportCard.tsx
- **涉及组件:** index.css, PaperCard.tsx, ReportCard.tsx
- **修改步骤:**
  1. 在 index.css 末尾添加：
     ```css
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after {
         animation-duration: 0.01ms !important;
         animation-iteration-count: 1 !important;
         transition-duration: 0.01ms !important;
       }
     }
     ```
  2. PaperCard/ReportCard 的 `motion.div` 使用 `<MotionConfig reducedMotion="user">` 包裹
  3. 或将 motion 入场动画改为 CSS animation 以受全局规则控制
- **验收标准:**
  - 系统设置 "Reduce motion" 后所有动画停止
  - 功能不受影响（动画只是快速完成）
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 20
- **推荐 Commit Message:** `fix(a11y): support prefers-reduced-motion for all animations`

---

#### Task UX-17: 持久化 Panel 宽度

- **Task ID:** UX-17
- **标题:** 将 Sidebar/Detail/Workspace 面板宽度持久化
- **修改目标:** 重启应用后保持面板布局
- **涉及页面:** App.tsx
- **涉及组件:** App.tsx
- **修改步骤:**
  1. 在 App.tsx 中 `useEffect` 加载时从 settings 读取 `sidebarWidth`、`detailWidth`、`workspaceWidth`
  2. 在 resize handler 中 debounce 保存到 settings（500ms，与 workspaceChatHeight 相同模式）
  3. 默认值保持不变（224/384/480）
- **验收标准:**
  - 调整面板宽度后重启应用保持
  - 不影响首次使用体验
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 21
- **推荐 Commit Message:** `feat(ui): persist panel widths across sessions`

---

#### Task UX-18: 错误处理改进——消除 `void 0` catch

- **Task ID:** UX-18
- **标题:** 为所有静默 catch 添加 Toast 错误反馈
- **修改目标:** 操作失败时用户得到反馈
- **涉及页面:** Sidebar.tsx, DocumentList.tsx, Board.tsx
- **涉及组件:** Sidebar.tsx, DocumentList.tsx, Board.tsx
- **修改步骤:**
  1. 全局搜索 `catch { void 0 }` 和 `catch { void 0 }` 模式
  2. 替换为 `catch (e) { useDocumentStore.getState().showToast(errorMessage(e, '操作描述')) }`
  3. Board.tsx 中的 `console.warn` 也替换为 Toast
  4. 确保错误消息有 i18n 支持（或使用 fallback 英文）
- **验收标准:**
  - 无 `catch { void 0 }` 模式
  - 操作失败时显示 Toast
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 22
- **推荐 Commit Message:** `fix(ux): show toast feedback for silenced error catches`

---

### Phase 4: Low Priority - Polish & Refactoring

---

#### Task RF-01: 提取共享 Markdown 配置

- **Task ID:** RF-01
- **标题:** 统一 Markdown 渲染配置
- **修改目标:** 消除 ChatPanel 和 ReportCard 中的重复配置
- **涉及页面:** ChatPanel.tsx, ReportCard.tsx
- **涉及组件:** 新建 `src/renderer/utils/markdown.tsx`；修改 ChatPanel.tsx, ReportCard.tsx
- **修改步骤:**
  1. 创建 `src/renderer/utils/markdown.tsx`
  2. 导出 `REMARK_PLUGINS`、`REHYPE_PLUGINS`、`MARKDOWN_COMPONENTS`
  3. ChatPanel 和 ReportCard import 共享配置
  4. 保留 ChatPanel 特有的 `refora://` 链接处理作为可选 prop
- **验收标准:**
  - Markdown 配置在一处定义
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 23
- **推荐 Commit Message:** `refactor: extract shared markdown configuration`

---

#### Task RF-02: Settings Modal 分组优化

- **Task ID:** RF-02
- **标题:** Settings Modal 按功能分组并添加滚动
- **修改目标:** 设置查找效率提升
- **涉及页面:** SettingsModal.tsx
- **涉及组件:** SettingsModal.tsx
- **修改步骤:**
  1. 将设置分为 3 个 Section：General (library, proxy, mailto)、Appearance (theme, language, sidebar)、AI Providers
  2. 每个 Section 有标题和描述
  3. Modal body 设置 `max-height: 70vh; overflow-y: auto`
  4. 考虑使用 Tabs 分离 General 和 AI Providers
- **验收标准:**
  - 设置有明确分组
  - 长内容可滚动
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 24
- **推荐 Commit Message:** `feat(settings): group settings into sections with scroll support`

---

#### Task RF-03: 主题切换改为 Popover

- **Task ID:** RF-03
- **标题:** 主题切换从循环点击改为 popover 选择
- **修改目标:** 主题切换可预测
- **涉及页面:** Sidebar.tsx
- **涉及组件:** Sidebar.tsx
- **修改步骤:**
  1. 主题按钮点击后弹出 popover（3 个选项：System / Light / Dark）
  2. 当前模式有 check 标记
  3. 或移除 Sidebar 中的主题按钮，只在 Settings 中提供
- **验收标准:**
  - 主题切换可预测
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 25
- **推荐 Commit Message:** `refactor(ui): change theme switcher from cycle to popover`

---

#### Task RF-04: 添加快捷键提示

- **Task ID:** RF-04
- **标题:** 在 tooltip 中显示快捷键
- **修改目标:** 快捷键可发现性提升
- **涉及页面:** 全局
- **涉及组件:** Sidebar.tsx, ChatPanel.tsx, DocumentList.tsx
- **修改步骤:**
  1. 创建 `ShortcutHint` 组件或在 tooltip 格式中统一添加快捷键后缀
  2. 在所有有快捷键的按钮 title 中添加快捷键（如 "New Chat (⌘N)"）
  3. 检查 `useAppShortcuts.ts` 中定义的所有快捷键，确保 UI 中有对应提示
- **验收标准:**
  - 所有快捷键在 UI 中有提示
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 26
- **推荐 Commit Message:** `feat(ux): show keyboard shortcuts in tooltips`

---

#### Task RF-05: 拆分 Sidebar 大组件

- **Task ID:** RF-05
- **标题:** 将 850 行 Sidebar 拆分为子组件
- **修改目标:** 代码可维护性
- **涉及页面:** Sidebar.tsx
- **涉及组件:** 新建 `SidebarSmartItems.tsx`、`SidebarWorkspaces.tsx`、`SidebarCategories.tsx`、`SidebarFooter.tsx`；修改 Sidebar.tsx
- **修改步骤:**
  1. 提取 SmartItems（All Files / Recent / Starred）
  2. 提取 Workspaces section（含 CRUD 逻辑）
  3. 提取 Categories section（含 CRUD 逻辑、drag-drop）
  4. 提取 Footer（Settings / Export / Theme）
  5. Sidebar.tsx 只负责布局和 collapsed 状态
- **验收标准:**
  - 每个子文件 < 300 行
  - 功能不变
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 27
- **推荐 Commit Message:** `refactor: split Sidebar into focused sub-components`

---

#### Task RF-06: 拆分 ChatPanel 大组件

- **Task ID:** RF-06
- **标题:** 将 2000 行 ChatPanel 拆分为子组件和 hooks
- **修改目标:** 代码可维护性
- **涉及页面:** ChatPanel.tsx
- **涉及组件:** 新建 `ChatMessages.tsx`、`ChatInput.tsx`、`ModelSelector.tsx`、`ThreadHistory.tsx`、`useChatStream.ts`；修改 ChatPanel.tsx
- **修改步骤:**
  1. 提取 `useChatStream` hook（streaming 逻辑、event handlers）
  2. 提取 `ModelSelector` 组件（模型选择器 + 下拉菜单）
  3. 提取 `ThreadHistory` 组件（对话历史下拉）
  4. 提取 `ChatMessages` 组件（消息流渲染）
  5. 提取 `ChatInput` 组件（输入区域 + 附件）
  6. ChatPanel.tsx 只负责布局和协调
- **验收标准:**
  - 每个文件 < 400 行
  - 功能不变
  - typecheck/lint/test 通过
- **是否可独立完成:** 是（但建议在 UX-10 之后）
- **推荐提交顺序:** 28
- **推荐 Commit Message:** `refactor: split ChatPanel into focused components and hooks`

---

#### Task RF-07: DetailPanel 字段分组

- **Task ID:** RF-07
- **标题:** DetailPanel 可编辑字段按功能分组
- **修改目标:** 信息查找效率
- **涉及页面:** DetailPanel.tsx
- **涉及组件:** DetailPanel.tsx
- **修改步骤:**
  1. 将 11 个字段分为 4 组：Basic (title, authors, year)、Publication (venue, volume, issue, pages)、Content (abstract, keywords)、Identifiers (url, doi)
  2. 每组有 sub-header（小字 label）
  3. abstract 字段限制初始高度，可展开
  4. 空值字段（"—"）可折叠
- **验收标准:**
  - 字段有明确分组
  - abstract 不挤占其他字段
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 29
- **推荐 Commit Message:** `feat(detail): group editable fields into sections`

---

#### Task RF-08: 搜索框 placeholder 说明搜索范围

- **Task ID:** RF-08
- **标题:** 搜索框 placeholder 明确搜索范围
- **修改目标:** 搜索可预测性
- **涉及页面:** DocumentList.tsx
- **涉及组件:** DocumentList.tsx, en.json, zh.json
- **修改步骤:**
  1. 修改 search placeholder 为 "Search title, authors, venue…"
  2. 更新 i18n key `topbar.search`
  3. 搜索结果中高亮匹配关键词（可选）
- **验收标准:**
  - 搜索框明确说明搜索范围
  - typecheck/lint/test 通过
- **是否可独立完成:** 是
- **推荐提交顺序:** 30
- **推荐 Commit Message:** `feat(ux): clarify search scope in placeholder text`

---

## Roadmaps & Checklists

### 1. UI Optimization Roadmap

```
Phase 1 (Critical - Foundation)
├── DS-01: Unified Button Component
├── DS-02: Unified Input Component
├── DS-03: Unified Card & Badge Components
└── DS-04: Single Source of Truth for Color Tokens

Phase 2 (High Priority - UX Fixes)
├── UX-01: Global Toast Component
├── UX-02: Unified Confirm Dialog
├── UX-03: ChatPanel Header Context
├── UX-04: DetailPanel Header Optimization
├── UX-05: useClickOutside Hook
├── UX-06: Auto-expand Agent Trace
├── UX-07: Streaming Elapsed Timer
├── UX-08: Improved Empty States
└── UX-09: Global Focus Visible

Phase 3 (Medium Priority - Polish)
├── UX-10: Simplify Chat Input Area
├── UX-11: Remove Dead Workspace Scope Button
├── UX-12: Handle Feedback Buttons
├── UX-13: Replace Native Select Elements
├── UX-14: Enlarge Checkbox Click Target
├── UX-15: WCAG AA Contrast Fix
├── UX-16: prefers-reduced-motion Support
├── UX-17: Persist Panel Widths
└── UX-18: Error Feedback for Silenced Catches

Phase 4 (Low Priority - Refactoring)
├── RF-01: Shared Markdown Config
├── RF-02: Settings Modal Sections
├── RF-03: Theme Switcher Popover
├── RF-04: Keyboard Shortcut Hints
├── RF-05: Split Sidebar Component
├── RF-06: Split ChatPanel Component
├── RF-07: DetailPanel Field Grouping
└── RF-08: Search Placeholder Clarity
```

---

### 2. Component Refactoring Plan

```
Current State (Fragmented)              →  Target State (Unified)
─────────────────────────────────────────────────────────────────
7 button implementations               →  1 <Button> with variants
4 input implementations                →  1 <Input> + 1 <Textarea>
3 card styles                          →  1 <Card> with variants
3 badge implementations                →  1 <Badge> with variants
4 confirm dialog implementations       →  1 <ConfirmDialog> via store
3 toast implementations                →  1 global <Toast>
4 popover implementations              →  1 useClickOutside hook
3 empty state implementations          →  1 <EmptyState> component
2 markdown configs                     →  1 shared markdown.tsx
850-line Sidebar.tsx                   →  5 focused components
2000-line ChatPanel.tsx                →  6 focused components + hooks
```

**New `ui/` Directory Structure:**
```
src/renderer/components/ui/
├── Button.tsx
├── Input.tsx
├── Textarea.tsx
├── Card.tsx
├── Badge.tsx
├── PanelHeader.tsx
├── EmptyState.tsx
├── Toast.tsx
├── ConfirmDialog.tsx (enhanced)
└── index.ts (barrel export)
```

---

### 3. Design System Improvement Plan

```
1. Color Tokens (Single Source)
   ├── CSS Variables (index.css) — primary definition
   ├── Antd Token Overrides — reference CSS vars
   └── Tailwind Config — reference CSS vars (already done)

2. Typography Scale
   ├── Display:   16px / 600 weight (titles)
   ├── Heading:   14px / 600 weight (section headers)
   ├── Body:      13px / 400 weight (default text)
   ├── Caption:   11px / 400 weight (labels, meta)
   └── Micro:     10px / 400 weight (badges, hints)

3. Spacing Scale (4px grid)
   ├── space-xs:  4px  (tight gaps)
   ├── space-sm:  8px  (default gaps)
   ├── space-md:  12px (section gaps)
   ├── space-lg:  16px (panel padding)
   └── space-xl:  24px (major sections)
   → Eliminate: 6px, 10px, 2px (non-grid values)

4. Icon Sizes
   ├── icon-sm:  14px (inline, dense UI)
   ├── icon-md:  16px (default buttons)
   └── icon-lg:  20px (empty states, headers)

5. Button Variants
   ├── primary:   bg-accent, text-white
   ├── secondary: bg-panel-2, text-foreground
   ├── ghost:     transparent, hover bg-hover
   ├── danger:    text-error or bg-error
   └── link:      text-accent, underline on hover

6. Border Radius
   ├── sm:  6px  (badges, small elements)
   ├── md:  10px (inputs, buttons)
   ├── lg:  14px (cards, modals)
   └── full: 9999px (pills, avatars)

7. Shadow Scale (already defined, keep as-is)
   ├── sm:  subtle elevation
   ├── md:  cards, dropdowns
   └── lg:  modals, overlays
```

---

### 4. AI Agent UX Improvement Plan

```
1. Transparency
   ├── Auto-expand trace during streaming (UX-06)
   ├── Show elapsed time (UX-07)
   ├── Inline tool execution indicators (future)
   └── Token usage per message (future)

2. Input Experience
   ├── Simplify input area (UX-10)
   ├── Remove dead UI (UX-11, UX-12)
   ├── Input draft persistence (future)
   └── Message editing (future)

3. Conversation Management
   ├── Thread title in header (UX-03)
   ├── Persistent thread sidebar (future, high effort)
   ├── Thread search (future)
   └── Export conversation (already exists)

4. Model Management
   ├── Simplified model selector (UX-10)
   ├── Search-based model picker (future)
   └── Model switch hint (already exists)

5. Response Quality
   ├── Code block copy buttons (future)
   ├── Citation links (already exists)
   ├── Markdown rendering consistency (RF-01)
   └── Regenerate (already exists)
```

---

### 5. TODO Checklist for AI Coding Agents

> 以下 checklist 可直接交给 Cursor / Claude Code / Codex 等 AI Coding Agent 逐项执行。  
> 每个 Task 可独立提交，按推荐顺序执行以最小化冲突。

#### Phase 1: Design System Foundation

- [ ] **DS-01** Create `src/renderer/components/ui/Button.tsx` with variants (primary/secondary/ghost/danger/link) and sizes (sm/md/lg). Replace all 7 button implementations across the codebase. Run `npm run typecheck && npm run lint && npm run test`. Commit: `feat(ui): add unified Button component with variant system`

- [ ] **DS-02** Create `src/renderer/components/ui/Input.tsx` and `Textarea.tsx`. Replace `.search-input`, `.field-input`, LobeHub `<Input>` in search contexts. Remove `doc-search-input` CSS hack from `index.css:189-206`. Run gate. Commit: `feat(ui): add unified Input and Textarea components`

- [ ] **DS-03** Create `src/renderer/components/ui/Card.tsx` and `Badge.tsx`. Update PaperCard and ReportCard to use unified Card. Remove ReportCard's `border-l-2 border-l-accent` decoration. Remove PaperCard's local Badge component. Run gate. Commit: `feat(ui): add unified Card and Badge components`

- [ ] **DS-04** In `App.tsx`, change `tokenOverrides` to reference CSS variables (e.g., `colorPrimary: 'var(--color-accent)'`). Remove hardcoded hex values. Fix duplicate `--color-success` in `index.css` (lines 18-19, 57-58, 82-83). Run gate. Commit: `refactor(ui): unify color tokens to single source of truth`

#### Phase 2: High Priority UX Fixes

- [ ] **UX-01** Create `src/renderer/components/ui/Toast.tsx`. Subscribe to `documentStore.toastMessage`. Render in `App.tsx`. Remove toast code from `DetailPanel.tsx` (3 locations: lines 632-638, 659-665, 683-689). Run gate. Commit: `feat(ui): extract global Toast component`

- [ ] **UX-02** Extend `ConfirmDialog.tsx` to support custom title/message/confirmText via a confirm store. Replace inline delete dialogs in `Sidebar.tsx` (lines 803-823, 825-845) and `ChatPanel.tsx` (lines 1969-1997). Run gate. Commit: `refactor(ui): unify confirm dialogs to shared ConfirmDialog component`

- [ ] **UX-03** In `ChatPanel.tsx`, replace static "Chat" label (line 1317-1319) with current thread title from `useWorkspaceStore`. Fall back to "New conversation" when no active thread. Run gate. Commit: `feat(chat): show conversation title in ChatPanel header`

- [ ] **UX-04** Create `src/renderer/components/ui/PanelHeader.tsx` (36px height, title + close). Replace 3 header instances in `DetailPanel.tsx` (lines 620-630, 644-656, 670-681). Run gate. Commit: `feat(ui): add PanelHeader component and optimize DetailPanel header`

- [ ] **UX-05** Create `src/renderer/hooks/useClickOutside.ts`. Replace 4 `useEffect` popover-close patterns in `ChatPanel.tsx` (modelMenu, threadMenu, attachMenu, workspaceScope). Add Escape key support. Run gate. Commit: `refactor(hooks): extract useClickOutside hook for popover management`

- [ ] **UX-06** In `AgentTracePanel` (`ChatPanel.tsx`), auto-set `open=true` when `streaming && visible.length > 0`. Use `useEffect` on `streaming` prop. Do not auto-collapse when streaming ends. Run gate. Commit: `feat(chat): auto-expand agent trace during streaming`

- [ ] **UX-07** Add `streamingStartTime` state in `ChatPanel.tsx`. Use `setInterval` to update elapsed time every second. Display "Thinking… (Xs)" or "Thinking… (Xm Ys)" next to thinking dots (line 1496-1507). Clear on stream end. Run gate. Commit: `feat(chat): show elapsed time during streaming`

- [ ] **UX-08** Create `src/renderer/components/ui/EmptyState.tsx` (props: icon, title, description, action). Update empty states in `DocumentList.tsx` (line 457-459), `Board.tsx` (line 248-251), `DetailPanel.tsx` (line 656-658). Add CTA buttons where applicable. Run gate. Commit: `feat(ui): improve empty states with icons and CTAs`

- [ ] **UX-09** Add global `:focus-visible` rule in `index.css` for all interactive elements (button, [role="button"], a, input, textarea, select). Remove duplicate `:focus-visible` rules from `.toolbar-btn`, `.sidebar-item`, `.sidebar-header-btn`. Run gate. Commit: `fix(a11y): add global focus-visible styles for keyboard navigation`

#### Phase 3: Medium Priority Polish

- [ ] **UX-10** Move model selector and deep thinking toggle from input area to ChatPanel header. Input area keeps only: attach button + textarea + send/stop. Run gate. Commit: `refactor(chat): simplify input area by moving controls to header`

- [ ] **UX-11** Remove `workspaceScopeOpen` state, `workspaceScopeRef`, related `useEffect`, and the Workspace scope button + popover from `ChatPanel.tsx` (lines 538, 555, 914-942, 1671-1696). Run gate. Commit: `fix(chat): remove non-functional workspace scope button`

- [ ] **UX-12** Remove ThumbsUp/ThumbsDown buttons and `feedback` state from `ChatPanel.tsx` (lines 533, 1435-1451). Clean up i18n keys. Run gate. Commit: `fix(chat): remove non-functional feedback buttons`

- [ ] **UX-13** Replace native `<select>` in `DetailPanel.tsx` CategoryChips (line 313-332) with context menu. Replace native `<select>` in BulkBar (line 575-588) with LobeHub `<Select>`. Run gate. Commit: `refactor(ui): replace native select with unified component`

- [ ] **UX-14** In `DocumentList.tsx`, change checkbox from `h-3 w-3` to `h-4 w-4`. Change checkbox column from `w-8` to `w-10`. Update SkeletonRows widths accordingly. Run gate. Commit: `fix(ux): enlarge checkbox click target in document list`

- [ ] **UX-15** In `index.css`, change dark `--color-muted` from `#9a9a9a` to `#a8a8a8`. Change light `--color-muted` from `#6e6e73` to `#5f5f64`. Verify contrast ratio ≥ 4.5:1 on all background colors. Run gate. Commit: `fix(a11y): adjust muted color for WCAG AA contrast compliance`

- [ ] **UX-16** Add `@media (prefers-reduced-motion: reduce)` block in `index.css` to disable all animations/transitions. Wrap PaperCard and ReportCard motion components in `<MotionConfig reducedMotion="user">`. Run gate. Commit: `fix(a11y): support prefers-reduced-motion for all animations`

- [ ] **UX-17** In `App.tsx`, load `sidebarWidth`, `detailWidth`, `workspaceWidth` from settings on mount. Debounce-save (500ms) on resize. Use same pattern as `workspaceChatHeight` in `WorkspacePanel.tsx`. Run gate. Commit: `feat(ui): persist panel widths across sessions`

- [ ] **UX-18** Search for all `catch { void 0 }` patterns in `Sidebar.tsx`, `DocumentList.tsx`, `Board.tsx`. Replace with `catch (e) { useDocumentStore.getState().showToast(errorMessage(e, 'description')) }`. Replace `console.warn` in Board.tsx with Toast. Run gate. Commit: `fix(ux): show toast feedback for silenced error catches`

#### Phase 4: Low Priority Refactoring

- [ ] **RF-01** Create `src/renderer/utils/markdown.tsx` exporting `REMARK_PLUGINS`, `REHYPE_PLUGINS`, `MARKDOWN_COMPONENTS`. Update `ChatPanel.tsx` and `ReportCard.tsx` to import from shared module. Run gate. Commit: `refactor: extract shared markdown configuration`

- [ ] **RF-02** In `SettingsModal.tsx`, group settings into 3 sections (General / Appearance / AI Providers) with section titles. Add `max-height: 70vh; overflow-y: auto` to Modal body. Run gate. Commit: `feat(settings): group settings into sections with scroll support`

- [ ] **RF-03** In `Sidebar.tsx`, replace `cycleTheme()` (line 510-514) with a popover showing 3 options (System/Light/Dark) with check marks. Use `useClickOutside` hook. Run gate. Commit: `refactor(ui): change theme switcher from cycle to popover`

- [ ] **RF-04** Audit `useAppShortcuts.ts` for all defined shortcuts. Add shortcut hints to corresponding button `title` attributes in format `"Label (⌘X)"`. Run gate. Commit: `feat(ux): show keyboard shortcuts in tooltips`

- [ ] **RF-05** Split `Sidebar.tsx` (850 lines) into: `SidebarSmartItems.tsx`, `SidebarWorkspaces.tsx`, `SidebarCategories.tsx`, `SidebarFooter.tsx`. Sidebar.tsx becomes layout container only. Run gate. Commit: `refactor: split Sidebar into focused sub-components`

- [ ] **RF-06** Split `ChatPanel.tsx` (2000 lines) into: `useChatStream.ts` (hook), `ModelSelector.tsx`, `ThreadHistory.tsx`, `ChatMessages.tsx`, `ChatInput.tsx`. ChatPanel.tsx becomes layout container only. Run gate. Commit: `refactor: split ChatPanel into focused components and hooks`

- [ ] **RF-07** In `DetailPanel.tsx` SingleDetail, group EDITABLE_FIELDS into 4 sections (Basic/Publication/Content/Identifiers) with sub-headers. Limit abstract field initial height with expand option. Run gate. Commit: `feat(detail): group editable fields into sections`

- [ ] **RF-08** Update `topbar.search` i18n key in `en.json` and `zh.json` to "Search title, authors, venue…". Run gate. Commit: `feat(ux): clarify search scope in placeholder text`

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Issues Found | 52 |
| Critical Priority | 3 |
| High Priority | 13 |
| Medium Priority | 22 |
| Low Priority | 14 |
| Total Tasks | 30 |
| Phase 1 (Critical) | 4 tasks |
| Phase 2 (High) | 9 tasks |
| Phase 3 (Medium) | 9 tasks |
| Phase 4 (Low) | 8 tasks |
| Easy Complexity | 14 tasks |
| Medium Complexity | 11 tasks |
| Hard Complexity | 5 tasks |
