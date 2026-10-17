# cordis-py · 字典场景引擎内核（Python 版）

> 基于**迷你 Cordis 插件容器**的文字冒险 / 互动叙事引擎。核心理念一句话：
> **场景即字典，能力即插件** —— 内容由场景字典描述，引擎的每个能力是一个可插拔插件，
> 两者通过 `cordis.json` 声明式组装。

本仓库是 Node 版 [dse-core](https://gitee.com/siwpan/dse-core) 的 **Python 移植**：
同一套设计、同一套字段、同一套事件协议，零第三方依赖（标准库即可跑）。
自带的 `content/starter.py` 只是骨架演示（五种模式各用一遍），随时可摘。

- Node 版（同仓库 `master` 分支）：https://gitee.com/siwpan/dse-core
- 本文件所在分支：`cordis-py`
- 两版差异清单：[docs/DIFF-FROM-NODE.md](docs/DIFF-FROM-NODE.md)

---

## 30 秒上手

```bash
python cli.py doctor                       # 环境 + 内容图自检
python cli.py play --input "1,1,a,a,quit"  # 脚本驱动跑一条线
python game.py                             # 交互式（等价 cli.py play）
python -m unittest discover -s tests       # 全套测试（84 项）
python scripts/lint_content.py             # 内容校验
```

当库用：

```python
from sdk import create_engine, inspect_project

ctx = create_engine({'root': './my-game', 'input': '1,1'})   # 启动（同步阻塞到退出）
print(inspect_project('./my-game'))                          # 只读体检，不启引擎
```

Windows 下若终端中文乱码，加 `PYTHONIOENCODING=utf-8`。

开一个新内容包：

```bash
python cli.py new my-pack --template=hub --ns=my --register
#   → 生成 content/my-pack.py（骨架 + TODO），并挂进 cordis.json
python cli.py check
```

---

## ⚠️ 安全须知

**内容包不是数据文件，是可执行代码。**

- `content/*.py` 通过 `importlib` 加载，模块顶层语句会立即执行，拥有完整的 Python 权限
  （读写文件、发起网络请求、执行子进程）。
- 条件表达式最终走 `eval`，**不是沙箱**（限制 builtins 只防误操作）。
- 启用热重载后，`content/` 下的改动会被自动重新加载，无需确认。

因此：只装可信来源；`scenes.validate()` 只是开发体验检查（加载先于校验），
靠它"过滤"不可信包是无效的；来源不明的内容请在容器/沙箱里跑。
触发面仅限内容包与插件清单的 `when` 字段 —— 玩家在终端输入的内容不会进入表达式求值。

---

## 目录结构

```
cordis-py/
├── cordis/                # 迷你 Cordis 内核（零依赖）
│   ├── context.py         #   服务容器 + 依赖注入 + emit/waterfall/bail + effect
│   └── service.py         #   Service 基类（name / inject）
├── plugins/               # 引擎插件（每个能力一个，通过 ctx.<service> 通信）
│   ├── scenes.py          #   ctx.scenes   场景字典：加载 / 校验 / 查询 / 热重载
│   ├── state.py           #   ctx.state    状态：点路径读写 / 效果 / 条件 / 插值
│   ├── console_io.py      #   ctx.io       终端 IO（换 UI 只换这个插件）
│   ├── engine.py          #   ctx.engine   主循环 + 模式扩展点
│   ├── save.py            #   ctx.save     存档（白名单 + 原子写 + 坏档兜底）
│   ├── save_migrate.py    #   ctx.save-migrate 存档版本迁移（骨架）
│   ├── achievements.py    #   成就（纯事件驱动）
│   ├── i18n.py            #   本地化（骨架，未命中直通）
│   ├── combat.py          #   battle 模式：回合制战斗
│   ├── trade.py           #   trade 模式：经营 + 确定性行情
│   ├── diary.py           #   diary 模式：日记回溯
│   ├── dialogue.py        #   dialogue 模式：话题询问
│   ├── sound.py           #   音效骨架（事件订阅 + player 钩子）
│   ├── hot_reload.py      #   内容热重载（默认关闭）
│   └── lib/global_commands.py  # 全局命令放行名单
├── lib/                   # 核心库：boot / dict / modes / graph / registry / version
├── sdk/__init__.py        # 编程式入口：create_engine / inspect_project
├── schema/scene.schema.json
├── templates/             # 7 种叙事结构模板（cli.py new 用）
├── content/starter.py     # 自带示例内容（14 场景 / 5 结局）
├── scripts/lint_content.py
├── tests/                 # test_unit / test_e2e / test_cli + fixtures
├── cli.py / game.py
└── docs/                  # ARCHITECTURE / DIFF-FROM-NODE / NARRATIVE-LEDGER
```

---

## 场景字典

一个内容包 = 模块级 `SCENES` 字典 + 可选 `PACK` 元数据（也支持 `.json` 文件）：

```python
PACK = {
    'id': 'starter', 'name': '启程', 'version': '0.1.0',
    'entry': 'start', 'modes': ['battle'],
    'requires': {'plugins': ['combat'], 'state': ['gold']},
}

SCENES = {
    'start': {
        'title': '村庄 · 晨雾',
        'text': '{name}，你的 HP 是 {hp}。',        # 状态插值
        'onEnter': {'gold': -5},
        'choices': [                                # 省略或空 = 结局场景
            {
                'text': '花 10 金币买剑',
                'if': 'gold >= 10',                 # 显示条件
                'do': {'gold': -10, 'items.rusty_sword': 1},
                'goto': 'castle',                   # 或 '@restart' / '@loop:<场景ID>'
            },
        ],
    },
}
```

**效果语义**：数值 = 加减；非数值 = 赋值；点路径 = 深层写入。
**条件**：字符串表达式，兼容 Node 版写法（`===` / `&&` / `!x` 会自动转换）。

完整字段定义见 `schema/scene.schema.json`，与运行时 `scenes.validate()` 口径一致。

---

## 模式扩展点（scene.mode）

场景声明 `mode: 'battle'` 后，引擎发出 `scene/mode` 事件；能力插件返回真值即接管
该场景的输入与界面，引擎不再渲染选项、不再判定结局。已落地四种：
`battle` / `trade` / `diary` / `dialogue`。

> **新增一种 mode 要改 3 个地方**：
> ① 新插件里 `ctx.on('scene/mode', ...)` 返回真值接管；
> ② `lib/modes.py` 加一条（`register_mode('shop', edges=['onClose'])`）——
> 校验器、图遍历、CLI 自动同步，**不要再在别处抄一份表**；
> ③ 插件清单里注册插件 + `state.initial` 声明所需字段。

---

## 命令行

```bash
python cli.py play [--input "1,2,a"] [--entry <ID>] [--quiet]
python cli.py scenes [--json] [--scene <ID>]
python cli.py info [--json]
python cli.py check
python cli.py packs [--json]
python cli.py new <包名> [--template=branch] [--ns=ns] [--register]
python cli.py doctor
python cli.py saves
```

| 命令 | 启动主循环 | 占用 stdin |
|---|---|---|
| `play` | 是 | `--input` 时不占 |
| `scenes` / `info` / `packs` / `check` / `doctor` / `saves` | 否 | 否 |

约定：**stdout 只放结果，诊断走 stderr**（保证 `--json` 管道消费不被污染）；错误退出码非零。

---

## 测试

```bash
python -m unittest discover -s tests -v      # 全部 84 项
python -m unittest tests.test_unit           # 40 项：内核 / 状态 / 图 / 注册 / i18n / 迁移 / SDK
python -m unittest tests.test_e2e            # 25 项：真实子进程跑四种模式 + 存档 + SDK 外部项目
python -m unittest tests.test_cli            # 19 项：子命令退出码与 --json 契约
python scripts/lint_content.py               # 11 项内容校验（当前 0 错 0 警）
```

`tests/fixtures/loop_project/` 是一个**外部内容项目**，用来验证
`create_engine({'root': ...})` —— 一个引擎可以驱动任意目录下的内容。

---

## 环境要求

- Python >= 3.10（本地 3.13 验证）；**零必需依赖**
- 可选：`PyYAML`（读 `cordis.yml`）、`pytest`（测试用 unittest 也能跑）

## 踩坑记录

1. **插件解析不能 `getattr(module, 'Service')`** —— 插件模块都 `from cordis import Service`，
   取到的是基类，注册名叫 `Service`，第二个插件就撞名报错。要找"本模块定义的 Service 子类"
   （`value.__module__ == module.__name__`）。
2. **`apply` 对数值是加减不是赋值** —— 要"设置"用 `state.set`（经营天数踩过：1 + 2 = 3）。
3. **条件里的字符串字面量**必须在标识符改写前挖出来再回填，否则 `flags.x === "both"` 里的
   `both` 会被当成状态字段（Node 版踩过同一坑）。
4. **日志走 stderr**，否则 `scenes --json | jq` 会被诊断信息污染（Node 版的 logger 默认写 stdout）。
5. **选项编号是条件过滤后的序号** —— 互斥条件的两条不会同时显示，编号会前移（写测试时注意）。
6. **可选增强不要写进 `inject`** —— 否则宿主不注册该插件时，依赖方永不启动（存档迁移踩过）。
7. **结局口径**：有可选项（哪怕只是 `@restart`）就不打印「（完）」，把页面留给玩家选；
   真正无选项的终局才打印「（完）」。
8. **Windows 中文输出**：子进程里设 `PYTHONIOENCODING=utf-8`，否则管道里会乱码/报错。
9. **退出不用 `sys.exit()`**：先 `ctx.dispose()` 让插件清理副作用跑完，再由调用方决定退出码。
