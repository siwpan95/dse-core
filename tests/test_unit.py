"""引擎单元测试（库级，不启子进程）。

    python -m unittest tests.test_unit -v
    或：python tests/test_unit.py

覆盖：迷你 cordis 内核 / 状态语义 / 图分析 / 模式注册表 / 内容包注册表 /
      本地化 / 存档迁移 / SDK 门面。
"""

from __future__ import annotations

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from cordis import Context, Service                    # noqa: E402
from lib.graph import analyze, shortest_path, is_ending, edges_of  # noqa: E402
from lib.modes import (                                # noqa: E402
    MODE_REGISTRY, register_mode, mode_edges, mode_edge_table, mode_names,
    is_known_mode, is_special_goto, resolve_goto,
)
from lib.registry import (                             # noqa: E402
    load_packs, normalize_manifest, validate_manifest,
)
from lib.dict import load_dict                         # noqa: E402
from plugins.state import StateService                 # noqa: E402
from plugins.scenes import SceneService               # noqa: E402
from plugins.i18n import I18nService                  # noqa: E402
from plugins.save_migrate import SaveMigrateService    # noqa: E402


def make_state(initial=None) -> StateService:
    ctx = Context(base_dir=ROOT)
    return StateService(ctx, {'initial': initial or {}})


# ── 迷你 cordis 内核 ──────────────────────────────────────────────
class TestCordis(unittest.TestCase):
    def test_service_registration_and_access(self):
        class Foo(Service):
            name = 'foo'

        ctx = Context()
        ctx.plugin(Foo)
        self.assertIs(ctx.foo, ctx.services['foo'])

    def test_accessing_unregistered_service_raises(self):
        ctx = Context()
        with self.assertRaises(AttributeError):
            _ = ctx.nope

    def test_duplicate_registration_raises(self):
        class Foo(Service):
            name = 'foo'

        ctx = Context()
        ctx.plugin(Foo)
        with self.assertRaises(RuntimeError):
            ctx.plugin(Foo)

    def test_inject_defers_until_dependency_ready(self):
        class Dep(Service):
            name = 'dep'

        class Needs(Service):
            name = 'needs'
            inject = ['dep']

        ctx = Context()
        self.assertIsNone(ctx.plugin(Needs))          # 依赖未就绪 → 挂起
        self.assertEqual(ctx.pending, ['needs'])
        ctx.plugin(Dep)                                # 依赖到位 → 自动启动
        self.assertTrue(ctx.has('needs'))
        self.assertEqual(ctx.pending, [])

    def test_emit_and_bail(self):
        ctx = Context()
        seen = []
        ctx.on('ping', lambda x: seen.append(f'a{x}'))
        ctx.on('ping', lambda x: seen.append(f'b{x}'))
        ctx.emit('ping', 1)
        self.assertEqual(seen, ['a1', 'b1'])

        ctx.on('pick', lambda: None)
        ctx.on('pick', lambda: 'taken', prepend=True)
        self.assertEqual(ctx.bail('pick'), 'taken')

    def test_waterfall_chain_and_default(self):
        ctx = Context()
        order = []
        ctx.on('pipe', lambda x, next_: order.append('first') or next_(x + 1))
        ctx.on('pipe', lambda x, next_: order.append('second') or next_(x * 2))
        result = ctx.waterfall('pipe', 3, default=lambda x: f'default({x})')
        self.assertEqual(order, ['first', 'second'])
        self.assertEqual(result, 'default(8)')         # (3+1)*2

    def test_waterfall_prepend_short_circuit(self):
        ctx = Context()
        ctx.on('cmd', lambda line, next_: {'type': 'quit'})
        ctx.on('cmd', lambda line, next_: next_(line), prepend=True)
        self.assertEqual(ctx.waterfall('cmd', 'x'), {'type': 'quit'})

    def test_effect_disposal_runs_in_reverse(self):
        ctx = Context()
        order = []
        ctx.effect(lambda: order.append('first'))
        ctx.effect(lambda: order.append('second'))
        ctx.dispose()
        self.assertEqual(order, ['second', 'first'])


# ── 场景图 ────────────────────────────────────────────────────────
class TestGraph(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_dict(ROOT)
        cls.dct = cls.data['dict']
        cls.entry = cls.data['entry']

    def test_project_graph_is_clean(self):
        report = analyze(self.dct, self.entry)
        self.assertEqual(report['dangling'], [])
        self.assertEqual(report['unreachable'], [])
        self.assertEqual(len(report['endings']), 5)
        self.assertEqual(report['endings_reachable'], report['endings'])

    def test_shortest_path(self):
        path = shortest_path(self.dct, self.entry, 'end-hero')
        self.assertIsNotNone(path)
        self.assertEqual(path[0], self.entry)
        self.assertEqual(path[-1], 'end-hero')

    def test_mode_edges_count_as_outgoing(self):
        edges = edges_of('wolf-fight', self.dct['wolf-fight'])
        targets = {e['to'] for e in edges}
        self.assertTrue({'forest-win', 'forest-lose', 'start'}.issubset(targets))
        self.assertTrue(all(e['kind'] == 'mode' for e in edges))

    def test_is_ending(self):
        self.assertTrue(is_ending(self.dct['end-hero']))
        self.assertFalse(is_ending(self.dct['start']))
        self.assertFalse(is_ending(self.dct['wolf-fight']))


# ── 模式注册表 ────────────────────────────────────────────────────
class TestModes(unittest.TestCase):
    def test_builtin_modes(self):
        for name in ('normal', 'battle', 'trade', 'diary', 'dialogue'):
            self.assertIn(name, mode_names())

    def test_edges(self):
        self.assertEqual(mode_edges('battle'), ['onWin', 'onLose', 'onFlee'])
        self.assertEqual(mode_edges('normal'), [])
        self.assertEqual(mode_edges('nope'), [])

    def test_register_custom_mode(self):
        register_mode('shop', edges=['onClose'], plugin='shop', desc='商店')
        self.assertTrue(is_known_mode('shop'))
        self.assertEqual(mode_edges('shop'), ['onClose'])
        self.assertIn('shop', mode_edge_table())
        MODE_REGISTRY.pop('shop', None)                 # 还原
        self.assertFalse(is_known_mode('shop'))

    def test_special_goto(self):
        self.assertTrue(is_special_goto('@restart'))
        self.assertTrue(is_special_goto('@loop:a.b'))
        self.assertFalse(is_special_goto('@nope'))
        self.assertEqual(resolve_goto('@loop:a.b'), 'a.b')
        self.assertEqual(resolve_goto('market'), 'market')


# ── 状态服务 ──────────────────────────────────────────────────────
class TestState(unittest.TestCase):
    def test_apply_adds_numbers_and_assigns_others(self):
        state = make_state({'hp': 20, 'name': '旅人'})
        state.apply({'hp': -5})
        self.assertEqual(state.get('hp'), 15)
        state.apply({'name': '张三'})
        self.assertEqual(state.get('name'), '张三')

    def test_dot_path_write_and_count(self):
        state = make_state({'items': {'sword': 1}})
        state.apply({'items.sword': 1, 'flags.doorOpen': True})
        self.assertEqual(state.get('items.sword'), 2)
        self.assertTrue(state.get('flags.doorOpen'))

    def test_unsafe_keys_rejected(self):
        state = make_state({'hp': 1})
        self.assertEqual(state.apply({'__proto__.polluted': 1}), [])
        self.assertFalse(state.set('constructor.prototype.x', 1))

    def test_interpolate(self):
        state = make_state({'name': '旅人', 'gold': 10})
        self.assertEqual(state.interpolate('你好，{name}，你有 {gold} 金'), '你好，旅人，你有 10 金')
        self.assertEqual(state.interpolate('缺失 {nope}'), '缺失 {nope}')

    def test_check_python_style(self):
        state = make_state({'hp': 20, 'gold': 0})
        self.assertFalse(state.check('hp >= 10 and gold > 0'))
        self.assertTrue(state.check('hp >= 10'))
        self.assertTrue(state.check(None))

    def test_check_accepts_node_style_operators(self):
        state = make_state({'gold': 10, 'items': {'token': 2}})
        self.assertTrue(state.check('gold >= 10 && items.token >= 1'))
        self.assertTrue(state.check('!flags.done'))
        state.apply({'flags.done': True})
        self.assertFalse(state.check('!flags.done'))

    def test_check_string_literal_not_treated_as_state(self):
        state = make_state({'flags': {'x': 'both'}})
        self.assertTrue(state.check("flags.x === 'both'"))
        self.assertTrue(state.check('flags.x == "both"'))

    def test_check_extra_scope(self):
        state = make_state({})
        self.assertTrue(state.check("scene === 'forest-win'", extra={'scene': 'forest-win'}))
        self.assertFalse(state.check("scene === 'forest-win'", extra={'scene': 'start'}))

    def test_check_error_returns_false(self):
        state = make_state({'hp': 1})
        self.assertFalse(state.check('hp >='))

    def test_reset_keeps_declared_domains(self):
        # 注意 initial 里不含这些值 —— 否则全量 reset 之后它们本来就还在
        state = make_state({'gold': 20, 'clues': {}, 'flags': {}})
        state.apply({'clues.loop.a': True, 'flags.loop.n': 3})
        state.reset(keep=['clues.loop', 'flags.loop'])
        self.assertEqual(state.get('gold'), 20)
        self.assertTrue(state.get('clues.loop.a'))
        self.assertEqual(state.get('flags.loop.n'), 3)
        state.reset()
        self.assertIsNone(state.get('flags.loop.n'))


# ── 场景服务 ──────────────────────────────────────────────────────
class TestScenes(unittest.TestCase):
    def setUp(self):
        self.ctx = Context(base_dir=ROOT)
        self.scenes = SceneService(self.ctx, {'packs': ['./content/starter.py']})
        self.scenes.init()

    def test_loaded_starter(self):
        self.assertEqual(self.scenes.size, 14)
        self.assertTrue(self.scenes.has('wolf-fight'))

    def test_validate_missing_fields(self):
        problems = self.scenes.validate({'a': {'title': '无正文'}, 'b': {'text': 'x', 'choices': [{'goto': 'a'}]}})
        self.assertTrue(any('缺少 text' in p for p in problems))
        self.assertTrue(any('选项缺少 text' in p for p in problems))

    def test_find_dangling(self):
        problems = self.scenes.find_dangling({
            'a': {'text': 'x', 'choices': [{'text': '走', 'goto': '不存在'}]},
            'b': {'text': 'x', 'choices': [{'text': '留下'}]},
        })
        self.assertTrue(any('不存在' in p for p in problems))
        self.assertTrue(any('缺少 goto' in p for p in problems))

    def test_rebuild_failure_keeps_old_dict(self):
        before = self.scenes.size
        self.scenes.loaded['./broken.py'] = {'x': {'text': 'x', 'choices': [{'text': '走', 'goto': '不存在'}]}}
        self.scenes.packs.append('./broken.py')
        with self.assertRaises(ValueError):
            self.scenes.rebuild()
        self.assertEqual(self.scenes.size, before)


# ── 内容包注册表 ──────────────────────────────────────────────────
class TestRegistry(unittest.TestCase):
    def test_load_packs_manifest(self):
        packs = load_packs(ROOT)
        self.assertEqual(len(packs), 1)
        meta = packs[0]['manifest']
        self.assertEqual(meta['id'], 'starter')
        self.assertEqual(meta['entry'], 'start')
        self.assertEqual(meta['modes'], ['battle', 'dialogue', 'diary', 'trade'])
        self.assertIn('combat', meta['requires']['plugins'])
        self.assertEqual(packs[0]['count'], 14)

    def test_validate_manifest(self):
        bad = normalize_manifest({'id': 'Bad ID', 'version': 'x'}, 'content/bad.py', {})
        problems = validate_manifest(bad)
        self.assertTrue(any('id' in p for p in problems))
        self.assertTrue(any('version' in p for p in problems))

    def test_validate_manifest_unknown_mode(self):
        problems = validate_manifest(normalize_manifest({'id': 'x', 'modes': ['batle']}, 'a.py', {}))
        self.assertTrue(any('未注册的模式' in p for p in problems))

    def test_normalize_defaults(self):
        meta = normalize_manifest({}, 'content/foo.py', {'foo.a': {'text': 'x'}})
        self.assertEqual(meta['id'], 'foo')
        self.assertEqual(meta['entry'], 'foo.a')
        self.assertEqual(meta['scenes'], 1)


# ── 骨架插件 ──────────────────────────────────────────────────────
class TestI18n(unittest.TestCase):
    def test_translate_and_fallback(self):
        ctx = Context(base_dir=ROOT)
        StateService(ctx, {'initial': {'locale': 'zh-CN'}})
        i18n = I18nService(ctx, {'defaultLocale': 'zh-CN',
                                 'locales': {'zh-CN': {'hi': '你好'}, 'en-US': {'hi': 'Hello'}}})
        self.assertEqual(i18n.translate('@hi@'), '你好')
        self.assertEqual(i18n.translate('原文照写'), '原文照写')
        self.assertEqual(i18n.translate('未命中 @no.such.key@'), '未命中 @no.such.key@')
        self.assertIn('no.such.key', i18n.missing())
        ctx.state.set('locale', 'en-US')
        self.assertEqual(i18n.translate('@hi@'), 'Hello')


class TestSaveMigrate(unittest.TestCase):
    def test_stamp_and_identity_migration(self):
        ctx = Context(base_dir=ROOT)
        mig = SaveMigrateService(ctx, {'version': 3, 'migrations': {}})
        self.assertEqual(mig.stamp({'slot': 'auto'})['version'], 3)
        self.assertTrue(mig.needs_migration({'version': 1}))
        self.assertFalse(mig.needs_migration({'version': 3}))
        result = mig.migrate({'version': 1, 'gold': 10})
        self.assertEqual(result['record']['gold'], 10)
        self.assertEqual(result['record']['version'], 3)

    def test_migration_chain(self):
        ctx = Context(base_dir=ROOT)
        mig = SaveMigrateService(ctx, {'version': 3, 'migrations': {}})
        mig.migrations[2] = lambda r: {**r, 'gold': (r.get('gold') or 0) * 2}
        mig.migrations[3] = lambda r: {**r, 'gold': (r.get('gold') or 0) + 1}
        result = mig.migrate({'version': 1, 'gold': 10})
        self.assertEqual(result['record']['gold'], 21)
        self.assertEqual(result['steps'], [2, 3])

    def test_failing_migration_rolls_back(self):
        ctx = Context(base_dir=ROOT)
        mig = SaveMigrateService(ctx, {'version': 2, 'migrations': {}})

        def boom(_record):
            raise RuntimeError('boom')

        mig.migrations[2] = boom
        result = mig.migrate({'version': 1, 'gold': 10})
        self.assertEqual(result['record']['gold'], 10)
        self.assertEqual(result['steps'], [])


# ── SDK ──────────────────────────────────────────────────────────
class TestSdk(unittest.TestCase):
    def test_inspect_project(self):
        from sdk import inspect_project
        report = inspect_project(ROOT)
        self.assertEqual(report['entry'], 'start')
        self.assertEqual(report['scenes'], 14)
        self.assertEqual(report['endings'], 5)
        self.assertEqual(report['unreachable'], [])
        self.assertEqual(report['packs'][0]['id'], 'starter')

    def test_exports(self):
        import sdk
        for name in ('create_engine', 'inspect_project', 'analyze', 'load_packs', 'register_mode'):
            self.assertTrue(callable(getattr(sdk, name)), f'SDK 缺少导出 {name}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
