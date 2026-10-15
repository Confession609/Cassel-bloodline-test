# 龙族血统与言灵测试平台

一个以卡塞尔档案风格呈现的单页测试网站，包含个人感受、龙文共鸣、隐藏分支、言灵档案与管理员专用云端档案库。

## 当前功能

- 首页档案信息校验与测试入口
- 个人感受题、07 符文记忆、08 声音符号、09 灵视补全、10 绩效复核
- 隐藏分支检测过渡与五道附加题
- 基于血统评级限制的言灵匹配
- Cloudflare D1 云端档案保存、同名同生日身份确认后重测更新与管理员删除
- 言灵库及黑天鹅港动画补充条目

## 本地运行

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

## 项目结构

- `app/assessment.tsx`：测试流程、评分、隐藏分支、档案库
- `app/globals.css`：页面视觉与交互动效
- `lib/spells.ts`：言灵库和匹配规则
- `public/`：符文、音频选项、徽记与记忆题图片
- `测试题.docx`：与网页规则同步的管理员核验题库

## 云端档案库

档案由答题完成后匿名提交到 `/api/archive`，答题人不需要登录，也不能读取档案列表。管理员从页面右上角进入档案库，密码由服务端验证后通过短期 HttpOnly 会话读取和删除档案。

首次部署到 Cloudflare 时需要完成以下配置：

1. 创建一个 Cloudflare D1 数据库，并把绑定名设置为 `DB`。
2. 将 `migrations/0001_create_archive_records.sql` 应用到该数据库。
3. 在 Worker/Pages 的服务端密钥中配置 `ARCHIVE_ADMIN_PASSWORD` 和随机的 `ARCHIVE_SESSION_SECRET`。
4. 本地预览可复制 `.dev.vars.example` 为 `.dev.vars` 并填写密钥；`.dev.vars` 已被 Git 忽略。

当前项目已经包含 D1 绑定、迁移、匿名写入、管理员会话、管理员读取和删除接口；真正连接到哪个 Cloudflare 账户及远程数据库，需要在部署平台中完成账号授权和数据库绑定。

## 档案身份确认与本次发布

首页称呼（ID）和生日填写完成、离开输入框时，通过 `POST /api/archive/identity` 查询是否重复；接口仅返回 `exists`。开始测试前再次核对。同ID同生日需选择“血统重测人”才可更新旧档案；选择“新生测试者”必须更换ID。身份由答题人自行声明，不是所有权认证。

保存接口 `POST /api/archive` 接收 `archiveMode`（`new` 或 `retest`，缺省为 `new`）与可选 UUID v4 `submissionId`。新建冲突返回 HTTP 409 / `IDENTITY_CONFLICT`，禁止静默覆盖；同一提交编号的网络重试不会生成重复档案。结果页遇到冲突时允许确认重测，或更换ID后保存，保留答题结果。管理员查询、删除与原有表结构不变。

本次通过 GitHub 网页上传时，按原层级更新以下文件（新建目录可使用 GitHub 的 Create new file 输入完整路径）：

- `app/assessment.tsx`
- `app/globals.css`
- `app/api/archive/route.ts`
- `app/api/archive/identity/route.ts`（新增）
- `lib/archive-identity.ts`（新增）
- `db/cloudflare-env.d.ts`（新增，仅补全现有服务端绑定的类型声明）
- `scripts/test-archive-identity.mjs`（新增，可选，仅本地验证）
- `README.md`

提交到 Cloudflare 关联分支后，等待自动部署；若未开启自动部署，手动触发一次构建部署。无需执行迁移、更换 D1、重新配置密钥或清空数据。不要用本地仍含占位数据库ID的 `vite.config.ts` 覆盖线上版本，也不要上传 `.dev.vars`、`node_modules`、`dist`、`.wrangler` 或 `.git`。

部署后刷新页面，用同一测试身份分别验证重测覆盖和新生换ID路径。旧版本页面的提交也不会再自动覆盖已有档案，但需刷新才能使用新的确认弹窗。

本地启动已初始化 D1 的 Worker 后，可运行 `node scripts/test-archive-identity.mjs http://127.0.0.1:5199` 验证接口。脚本只允许本机地址，使用唯一前缀的合成档案，并在结束时清理自己的测试记录；从本地 `.dev.vars` 读取管理员密码，或使用 `ARCHIVE_TEST_PASSWORD` 环境变量。
