# Contact Cards Contract

本文件是客服坐席名片功能的业务规格。实现、数据库迁移、API、UI 和测试必须以本文件为同一事实来源。

## 1. 产品定位

名片是客服在坐席设置中提前配置、长期复用的发送项。聊天时通过输入区 `+` 菜单直接选择发送，不在每次会话中临时录入号码或链接。

一名客服可以创建任意数量的名片。

## 2. 标准渠道

正式支持四种标准渠道：

- `sms`：短信
- `whatsapp`：WhatsApp
- `telegram`：Telegram
- `website`：网站 / 普通 HTTP(S) 链接

运行时不再把短信业务建模为 `phone`，也不再把所有非短信名片统一建模为 `link`。历史 `phone` / `link` 数据只允许在数据库迁移中出现，用于转换为 `sms` / `website`。

坐席设置中的类型选择使用一个紧凑下拉选择器，不使用四宫格或多行标签按钮。下拉触发器和选项都必须同时显示渠道图标、渠道名称与简短说明，在移动端不能因为类型选择占用两行表单高度。

## 3. 名片字段

每张名片包含：

- `label`：显示名称，例如“短信咨询”“WhatsApp 联系”。
- `kind`：`sms | whatsapp | telegram | website`。
- `value`：渠道目标。
  - SMS / WhatsApp：电话号码。
  - Telegram：用户名，不含 `@`。
  - Website：绝对 `http://` 或 `https://` URL。
- `presetMessage`：可选预设话术。
  - 只允许 SMS / WhatsApp / Telegram 使用。
  - Website 必须为空。
  - 预设话术只负责填入目标应用的输入框，不允许自动发送。
- 图标：默认使用渠道内置标准图标；允许上传自定义 PNG / JPG / WebP 作为覆盖图标。

## 4. 点击行为

名片点击后必须根据渠道生成目标地址：

- SMS：打开短信编辑界面；有 `presetMessage` 时尝试预填正文。
- WhatsApp：使用 `wa.me` 打开指定号码；有 `presetMessage` 时通过 `text` 参数预填。
- Telegram：使用 `t.me/<username>` 打开指定账号；有 `presetMessage` 时通过 `text` 参数预填。
- Website：直接打开配置的 HTTP(S) URL。

任何渠道都不得自动发送消息。

SMS 永远不得使用 `tel:`，名片功能不提供拨号行为。

## 5. 图标规则

- SMS 使用苹果 Messages / iMessage 的绿色消息图标样式。
- WhatsApp 使用 WhatsApp 官方品牌标志与品牌绿色。
- Telegram 使用 Telegram 官方纸飞机标志与品牌蓝色。
- Website 使用产品统一的网页图标，不伪装成第三方品牌。
- 三个渠道品牌 SVG 统一存放在 `public/icons/contact-card-*.svg`；不要用 Lucide 通用气泡或纸飞机替代，也不要在 TSX/CSS 中复制一份内联 SVG。
- 品牌图标由统一的 `AgentContactCardIcon` 语义组件提供，设置页、下拉选项、`+` 菜单、首次问候语和聊天消息不得各自维护不同画法。
- 未上传自定义图标时，不发起 R2 图标请求，直接渲染内置图标。
- 上传自定义图标后，设置页、`+` 菜单、自动问候附件、坐席消息历史和访客端消息快照都显示同一个自定义图标。
- 自定义图标最大 256 KB，只允许 PNG / JPG / WebP。
- 已发送消息必须保存图标引用快照；之后修改或删除名片图标不能改写历史消息。

## 6. 预设话术规则

- `presetMessage` 为可选字段，空值等价于未配置。
- 保存时去除首尾空白。
- 最大长度 2000 字符。
- SMS / WhatsApp / Telegram 允许配置。
- Website 不显示该输入项，API 也必须拒绝 Website 携带非空 `presetMessage`。
- URL 参数必须使用标准 URL 编码。

## 7. 历史兼容与清理

数据库迁移负责一次性转换历史数据：

- `phone` -> `sms`
- `link` -> `website`

运行时代码、UI 文案、测试和新 API 不再依赖 `phone` / `link` 作为名片类型。

旧的固定电话图标、`tel:` 行为、仅 SMS/Link 两类 UI、把自定义图标塞入图片 `original_name` 语义中的兼容实现都应在新模型稳定后删除或迁移，不保留第二套名片逻辑。

## 8. 测试约束

必须至少覆盖：

1. 四种渠道的输入归一化和拒绝规则；
2. SMS / WhatsApp / Telegram 的可选预设话术 URL；
3. Website 不允许预设话术；
4. SMS 不产生 `tel:`；
5. 内置图标按渠道选择，自定义图标仅作为覆盖；
6. 自定义图标引用不泄露 R2 object key；
7. 自动问候和手动发送都复制名片的 `kind / value / presetMessage / iconRef` 快照；
8. 修改或删除名片后，历史消息快照保持不变；
9. 历史 `phone/link` 数据迁移为 `sms/website`。
