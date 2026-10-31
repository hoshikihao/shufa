# AGENTS.md

## Layout
- `site/`：正式网站，纯静态，Cloudflare 直接托管此目录
  - 页面：`index.html`（首页）、`poems.html`（选诗）、`create.html`（生成，`?id=` 指定诗）、`works.html`（我的：本机作品）、`404.html`（不存在的路径）
  - `css/` 共用样式；`js/water.js` 水面与墨虾，`js/api.js` 原作者接口，`js/poems.js` 诗库，`js/works.js` 本机作品存储，`js/page-*.js` 各页逻辑；`assets/` 图片；`fonts/` 思源宋体切片（`css/fonts.css` 引用）；`data/anthology.json` 诗库
  - 页面专属样式写在该页 `<style>` 里
- `design/`：设计稿与素材，只读参考；不往画布发布
- `docs/`：原项目前端，只读参考，不改不删
- `tools/`：本机工具，不部署，`site/` 不引用
  - `writer.html`：自写诗文，字体由使用者从本机选取 TTF，只存在本机浏览器
- 临时脚本、截图放会话 scratchpad，不进仓库

## Implementation
- 只用 HTML、CSS、原生 JavaScript；不加依赖，不加构建步骤，不搬画布运行时
- 视觉以 `site/` 现状为准；`design/project/*.dc.html` 只作风格参考，不据此回改已有页面
- 水面与墨虾代码只在 `site/js/water.js` 保留一份
- 所有动效响应 `prefers-reduced-motion`
- `site/404.html` 里的资源和链接写根路径（以 `/` 开头）
- `site/` 的字体只用本站 `site/fonts/` 的思源宋体，不引用外部字体服务；字体样式表不阻塞渲染
- `site/data/anthology.json` 与 `docs/anthology.json` 内容一致
- 字体文件、打包文件不进仓库；`site/fonts/` 下的开源字体切片除外

## API
- 只调用 `POST /shufa-api/api/render` 和 `GET /shufa-api/api/quota`；不调用 `/api/admin/*`，不发送 `admin_key`
- 接口调用只写在 `site/js/api.js`
- 请求从访问者浏览器直接发出，不经 Worker 或任何代理
- `poem_id` 只取自诗库
- 作品图上的签条和二维码不裁剪、不遮挡
- 生成的作品只存在访问者本机浏览器（IndexedDB），不上传、不跨访问者汇总
- 本地地址（`localhost`、`127.0.0.1`）或带 `?mock=1` 时走模拟模式，返回 `site/assets/` 样张，不发真实请求；本地带 `?mock=0` 才发真实请求
- 开发期每次真实生成先征得用户同意

## Verification
- 本地服务：`python3 -m http.server 8731 --directory site`，用内置浏览器逐页检查
- `tools/` 本地服务：仓库根目录运行 `python3 -m http.server 8732 --bind 127.0.0.1`，打开 `/tools/writer.html`
- 动效在内置浏览器里检查，不凭 headless 截图判断
- 手机排版在 iOS 模拟器（iPhone 17 Pro）检查
- 检查各页在减少动态效果时的降级

## Deploy
- `wrangler.jsonc` 只托管 `./site` 静态资源，不写 Worker 脚本
- 部署、改 Cloudflare 配置、绑定域名前先经用户确认
