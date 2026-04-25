---
name: CodexDock
version: 1.0.0
colors:
  paper: "var(--paper)" # Light: #efebe1, Dark: #0b0c0b
  ink: "var(--ink)" # Light: #171612, Dark: #f3f2ec
  ink-soft: "var(--ink-soft)"
  ink-faint: "var(--ink-faint)"
  panel: "var(--panel)" # Light: #f7f4ed, Dark: #171815
  panel-strong: "var(--panel-strong)"
  line: "var(--line)"
  accent: "var(--accent)"
  success: "var(--success)" # Light: #0f766e, Dark: #5eead4
  warn: "var(--warn)" # Light: #a16207, Dark: #facc15
  danger: "var(--danger)" # Light: #b42318, Dark: #fca5a5
  surface-soft: "var(--surface-soft)"
  surface-hover: "var(--surface-hover)"
typography:
  fontFamily: "'SF Pro Display', 'Segoe UI Variable', 'Avenir Next', 'PingFang SC', 'Hiragino Sans GB', sans-serif"
  monoFamily: "'SF Mono', 'Fira Code', ui-monospace, monospace"
  baseFontSize: "13px"
  smallFontSize: "11px"
  tinyFontSize: "10px"
spacing:
  xs: "0.25rem" # 4px
  sm: "0.5rem" # 8px
  md: "0.75rem" # 12px
  lg: "1rem" # 16px
  xl: "1.5rem" # 24px
rounded:
  sm: "0.32rem"
  default: "0.45rem"
  lg: "0.75rem"
  xl: "1rem"
  full: "9999px"
shadows:
  elevation-1: "var(--elevation-1)"
  elevation-2: "var(--elevation-2)"
  elevation-floating: "var(--elevation-floating)"
  control-shadow: "var(--control-shadow)"
---

# CodexDock 设计规范 (DESIGN.md)

本文件定义了 CodexDock 的核心视觉语言与设计系统。在使用 AI 辅助生成 UI 组件时，请严格遵循本文件中的规范，以确保与项目的整体风格保持一致。

## 1. 核心设计理念

CodexDock 采用了**“融入原生应用”**和**极简紧凑**的设计风格。
它避免了浮夸的大圆角、大面积投影以及过大的间距，转而追求桌面端软件应有的高信息密度和精致感。

## 2. 颜色运用 (Colors)

本项目深度依赖 CSS Variables 来支持 Light/Dark 模式无缝切换。**绝对不要**在组件中硬编码 Hex 颜色值或使用纯白色 (`#FFFFFF`) / 纯黑色 (`#000000`) 作为背景。

- **Backgrounds (背景)**:
  - `paper`: 应用的最底层背景色。
  - `panel` / `panel-strong`: 用于卡片、弹出层或次级区域的背景。
- **Text (文本)**:
  - `ink`: 主要文本颜色。
  - `ink-soft` / `ink-faint`: 次要或辅助文本颜色，用于时间戳、提示信息等。
- **Borders (边框)**:
  - `line`: 默认边框颜色。所有卡片、分割线都应该使用此颜色，而不是 `border-gray-200`。
- **Interactive (交互)**:
  - `surface-soft`: 按钮、列表项的默认/静息态背景（通常用于次要按钮）。
  - `surface-hover`: 鼠标悬停时的反馈背景。

## 3. 字体与排版 (Typography)

- **字体族**: 默认使用系统原生字体 (`SF Pro Display`, `Segoe UI Variable`)。代码或需要等宽对齐的数据（如端口号、Token 数量、时间）必须使用等宽字体。
- **字号**: 桌面端要求紧凑。
  - 主标题/大数值通常不超过 `text-base` 或 `text-lg`。
  - 常规文本、列表内容多使用 `text-[12px]` 或 `text-[13px]`。
  - 辅助标签 (Pill)、表格表头多使用 `text-[10px]` 或 `text-[11px]`。
- **字重**: 重要数值、标题使用 `font-semibold` 或 `font-bold`。辅助标签常用 `font-medium` 配合 `uppercase tracking-wider`。

## 4. 间距与尺寸 (Spacing & Sizing)

- 保持内敛。组件间距 (gap) 通常使用 `gap-1.5` 到 `gap-3`。
- 面板内的 Padding 通常是 `p-3` 或 `p-4`。
- 图标按钮尺寸通常为 `h-7 w-7` 或 `h-8 w-8`，内部图标为 `h-3.5 w-3.5` 或 `h-4 w-4`。

## 5. 圆角与边框 (Borders & Radii)

- 放弃大圆角。
- 小型按钮、标签、输入框使用 `rounded-[0.35rem]` 或 `rounded-md`。
- 卡片、面板使用 `rounded-[0.45rem]` 到 `rounded-lg`。
- 绝大多数组件都应该带有 `border border-[var(--line)]` 的细边框，以明确边界。

## 6. 组件风格范例

### 按钮 (Buttons)
- **图标按钮**: `inline-flex items-center justify-center text-ink-soft hover:text-ink hover:bg-surface-hover transition-colors`
- **主操作按钮**: 背景色为 `bg-ink`，文字为 `text-paper`。
- **危险操作按钮**: 使用浅色背景 `bg-danger/10` 和 `text-danger`，悬停时加深 `hover:bg-danger/20`。

### 标签 / 状态药丸 (Status Pills)
- 尺寸极小，通常为 `px-1.5 py-0.5 text-[10px] font-medium`。
- 使用带透明度的边框和背景，例如：`border-success/20 bg-success/10 text-success`。

### 数据表格 (Tables)
- 拒绝使用 Div 模拟的流式列表，优先使用原生的 `<table>`。
- `thead` 应该吸顶 (`sticky top-0`)，字号为 `text-[10px]`，颜色为 `text-faint`。
- 表格单元格 (`td`) 使用较小的 Padding（如 `py-1.5 px-3`），并在行悬停时改变背景色 (`hover:bg-surface-hover`)。