# dsh-enter-combination

[English](README.md)

自定义 DeepSeek Harness 输入框里的两个按键：哪个键发送消息，哪个键换行。默认 Enter 发送、⌘/Ctrl + Enter 换行，两个都可以重新录制。

## 设置页

设置 → 发送按键（设置抽屉里独立的一项）。

| 行 | 默认 | 在输入框里按下时 |
| --- | --- | --- |
| 发送 | `Enter` | 把草稿发给 AI |
| 换行 | macOS 上 `⌘Enter`，其他平台 `Ctrl+Enter` | 光标换到下一行，不发送 |

点右侧的按键按钮，然后按下想用的组合：下一个真正的按键会连同那一刻按住的功能键一起被录下来，这一行立刻显示新的组合。`Esc` 取消（再点一次这个按钮也取消）；如果录到的组合和另一行重复，会拒绝并提示一句，而不是悄悄把另一行覆盖掉。

## 怎么接进输入框

这两个键都是 DSH 内部的固定接线——输入框自己的键盘映射把 Enter 当作发送、Shift+Enter 当作换行，两个都没有暴露成 slot。所以本插件在 `document` 上以捕获阶段监听 `keydown`，赶在输入框之前拿到事件，然后重放官方那条路径：

- **发送** → 调会话公开的提交动作（`conversation.input.for(scope).actions.submit()`），和「发送」按钮走同一个事务。两道保险：按住不放不会连发；会话还没建立时不动这个键，交回给官方 Enter 处理。
- **换行** → 在输入框的 contenteditable 上重新派发一次 `Shift+Enter` 的 `keydown`，这正是编辑器本来就认的换行。重放的事件是不可信的（`isTrusted === false`），监听器会忽略它，不会自己套自己。

中文输入法优先：输入法正在组字时（`isComposing`），两个键都留给输入框。

## 存储

`localStorage['dsh-enter-combination']`，按浏览器 profile 存。没有宿主那一半：读这份映射的只有当前页面的输入框，而映射本身只是两个组合键。代价是同一个 profile 换一台机器打开时回到默认值。

## 安装

需要会加载插件包（`package.json` 里的 `dsh.bundle`）的 DeepSeek Harness。

```
dsh plugin --profile desktop add link:/绝对路径/dsh-enter-combination
```

这会把目录以 `link:` 方式写进当前 profile 的 `package.json`，并把 bundle 加进 `dsh.profile.bundles`，所以改的是本目录源码，不是拷贝。

`client.js` 每次打开页面都会重新加载，但插件本身只在 Harness 启动时挂载：第一次要重启 Harness（退出再打开应用）才能在设置里看到这一项。之后改 `client.js` 只需刷新页面。

## 自检

```
npm test
```

`test/self-check.mjs` 按模块加载器的方式加载 `client.js`，用假的 DOM 跑一遍：拦截部分（默认键位、Shift+Enter 重放、非输入框、输入法、按住不放、没有会话）和录制部分（录一个新组合、Esc 取消、拒绝和另一行重复的组合、存储内容不可用时回退默认值）。

## 已知限制

- 组合键按 `event.code` 加四个功能键的标志匹配，跟的是物理按键而不是布局字符：Dvorak 布局下 `⌘Enter` 还是 `⌘Enter`；两个能打出同一个字符的键仍然是两个不同的组合。
- 记录的是按键的 code，所以屏幕上显示的是录下来的那个键的名字（例如小键盘回车显示 `Enter`，和主键盘回车是同一个组合）。
- 某一行处于录制状态时，下一次按键不管按在页面哪里都会被录制器拿走，不只是输入框里的键。
- 这份映射是浏览器 profile 的偏好：不跟着会话走，换浏览器或换机器都是默认值。
