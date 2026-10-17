"""服务基类。

    class SceneService(Service):
        name = 'scenes'
        inject = []

        def __init__(self, ctx, config=None):
            super().__init__(ctx, config)
            self.dict = {}

        def init(self):        # 可选：构造后由 Context 调用
            ...

`name` 即服务在 ctx 上的访问名（ctx.scenes）。
`inject` 声明的依赖全部就绪后，插件才会被实例化 —— 顺序由容器编排，不由声明顺序决定
（Node 版踩过：插件 init 顺序不等于 cordis.yml 声明顺序）。
"""

from __future__ import annotations

from typing import Any


class Service:
    name: str | None = None
    inject: list[str] = []

    def __init__(self, ctx: Any, config: dict | None = None) -> None:
        self.ctx = ctx
        self.config = config or {}
        # 与 Node 版一致：构造即注册，之后容器再调用 init()
        ctx.provide(self.name or type(self).__name__, self)

    def init(self) -> None:      # 可选覆写
        pass

    def __repr__(self) -> str:
        return f'<Service {self.name or type(self).__name__}>'
