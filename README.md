# sr-apocalyptic-plugin

> 人机代码 · 崩坏：星穹铁道「异相仲裁（末日幻影）」战绩查询插件

一个 Miao-Yunzai / Yunzai-Bot 插件，复用 miao-plugin 的米游社鉴权，
查询星穹铁道「异相仲裁」战绩，并按 miao 风格渲染为深色战绩卡片。

## 功能

- `*王琪` / `*异相仲裁` / `*末日幻影`：查询本期异相仲裁战绩
- `*王琪上期` / `*异相仲裁上期`：查询上期战绩
- 自动渲染深色战绩图（总星数、最深抵达、上/下半阵容与得分）
- 渲染失败时自动降级为文字结果

## 安装

需要已安装 [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) 与
[miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin)（本插件依赖其鉴权与 ck 管理）。

```bash
# 进入 Yunzai 根目录的 plugins
cd plugins

# 克隆本仓库
git clone <你的仓库地址> sr-apocalyptic-plugin

# 回到根目录安装依赖
cd ..
pnpm install --filter sr-apocalyptic-plugin
```

重启 Yunzai 即可生效。

## 用法

1. 先用 miao-plugin 绑定星铁 UID 并完成米游社登录：
   `#星铁绑定+UID`，并扫码 / 添加 ck。
2. 发送 `*异相仲裁` 或 `*王琪` 查询本期战绩。
3. 发送 `*异相仲裁上期` 查询上期战绩。

## 实现说明

- 鉴权 / ck / device_fp：复用 `miao-plugin/models/MysApi.js`，不重复造轮子。
- 接口：`game_record/app/hkrpg/api/challenge_boss`（异相仲裁），
  DS 签名沿用米游社 cn salt 规则。
- 渲染：调用 Yunzai 内置 `lib/puppeteer/puppeteer.js`，art-template 模板。

## 涉及 / 依赖的开源项目

- [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) — Bot 框架
- [miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) — 鉴权与面板能力
- [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) — 上游框架
- 数据来源：米游社 (miHoYo BBS) 公开战绩接口

## 开源协议

本项目以 MIT 协议开源。

```
MIT License

Copyright (c) 2026 人机代码

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction... (see LICENSE)
```

## 免责声明

本插件仅调用米游社公开战绩接口，用于个人战绩查询，请勿用于商业或滥用用途。
米游社、崩坏：星穹铁道相关版权归 miHoYo / HoYoverse 所有。
