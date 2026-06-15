# sr-apocalyptic-plugin

> TRSS-Yunzai 插件 · 崩坏：星穹铁道「异相仲裁 / 王棋」战绩查询

这是一个用于 **TRSS-Yunzai** 的崩坏：星穹铁道战绩查询插件，复用 TRSS-Yunzai / miao-plugin 的 UID、Cookie、米游社鉴权与图片渲染能力。

## 功能

- `*异相仲裁` / `#异相仲裁`：查询本期异相仲裁 / 王棋战绩
- `*王棋` / `#王棋`：查询本期战绩
- `*异相仲裁上期` / `#异相仲裁上期`：查询历史/上期战绩
- 自动渲染战绩图片；渲染失败时降级为文字结果

## 适用环境

- TRSS-Yunzai
- 已安装并正常配置 `miao-plugin`
- 已绑定星铁 UID 与可用米游社 Cookie

## 安装

在 TRSS-Yunzai 根目录执行：

```bash
cd plugins
git clone https://github.com/wq154/ayaka.git sr-apocalyptic-plugin
cd ..
pnpm install
```

或直接将本仓库放入：

```txt
TRSS-Yunzai/plugins/sr-apocalyptic-plugin
```

然后重启 TRSS-Yunzai。

## 使用

```txt
*异相仲裁
#异相仲裁
*王棋
#王棋
*异相仲裁上期
```

## 说明

本插件仅用于个人战绩查询，数据来源为米游社公开战绩接口。米游社、崩坏：星穹铁道相关版权归 miHoYo / HoYoverse 所有。
