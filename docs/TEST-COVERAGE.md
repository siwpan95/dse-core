# 剧情线结局覆盖矩阵（TEST-COVERAGE）

> 生成：2026-10-17 · 5 个结局 · 覆盖 5/5 · 生成器：node tests/coverage.mjs
> 覆盖来源：**T** = tests/traverse.mjs（结构-状态遍历，执行每条边/效果/条件）
>          **E** = tests/e2e.mjs（真实进程路径断言，按标题 waitFor 实跑）
> 门：两栏皆空（T✗ E✗）时退出码 1 —— 新结局必须至少落进其中一个来源。

| 结局 | 标题 | T | E |
|---|---|---|---|
| `end-broke` | 结局 · 空车回程 | ✓ | ✓ |
| `end-hero` | 结局 · 过河的人 | ✓ | ✗ |
| `end-merchant` | 结局 · 半间铺面 | ✗ | ✓ |
| `end-stay` | 结局 · 留在岸这边 | ✓ | ✗ |
| `forest-lose` | 结局 · 山道无归 | ✓ | ✗ |

✔ 全部结局至少有一个覆盖来源（traverse 或 e2e）。
