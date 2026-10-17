"""端到端测试：真实子进程跑完整线路并断言输出。

    python -m unittest tests.test_e2e -v

与单元测试的分工：
    test_unit   库级：服务与纯函数（快，不启进程）
    test_e2e    进程级：主循环、四种模式、存档、命令、@restart、SDK 外部项目根
"""

from __future__ import annotations

import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'cli.py')
FIXTURE = os.path.join(ROOT, 'tests', 'fixtures', 'loop_project')
RUNNER = os.path.join(ROOT, 'tests', 'fixtures', 'run.py')

ENV = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'DSE_MUTE': '1'}


def play(inputs: str, extra: list[str] | None = None) -> tuple[int, str]:
    args = [sys.executable, CLI, 'play', '--quiet']
    if inputs:
        args += ['--input', inputs]
    args += extra or []
    proc = subprocess.run(args, cwd=ROOT, env=ENV, capture_output=True, text=True,
                          encoding='utf-8', errors='replace')
    return proc.returncode, (proc.stdout or '') + (proc.stderr or '')


def run_fixture(inputs: str) -> tuple[int, str]:
    proc = subprocess.run([sys.executable, RUNNER, FIXTURE, inputs], cwd=ROOT, env=ENV,
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
    return proc.returncode, (proc.stdout or '') + (proc.stderr or '')


class TestEngineLoop(unittest.TestCase):
    def test_start_renders_entry(self):
        code, out = play('quit')
        self.assertEqual(code, 0)
        self.assertIn('村口 · 启程', out)
        self.assertIn('往北进山', out)

    def test_choice_moves_to_next_scene(self):
        _code, out = play('1,quit')
        self.assertIn('山道 · 林深处', out)
        self.assertIn('拔剑', out)

    def test_unknown_input_hint(self):
        code, out = play('zzz,quit')
        self.assertEqual(code, 0)
        self.assertIn('未识别的输入', out)

    def test_empty_input_redraws(self):
        _code, out = play(',quit')
        self.assertIn('村口 · 启程', out)


class TestBattleMode(unittest.TestCase):
    def test_battle_commands(self):
        _code, out = play('1,1,help,quit')
        self.assertIn('山道 · 遭遇', out)
        self.assertIn('战斗指令', out)

    def test_battle_reaches_a_result(self):
        _code, out = play('1,1,' + ','.join(['a'] * 14) + ',quit')
        self.assertTrue('山道 · 狼倒下之后' in out or '结局 · 山道无归' in out,
                        '战斗应分出胜负并流转')

    def test_defend_stance(self):
        _code, out = play('1,1,d,a,a,a,a,a,a,a,a,a,quit')
        self.assertIn('你举盾防御', out)

    def test_flee(self):
        _code, out = play('1,1,r,r,r,r,r,r,quit')
        self.assertTrue('你成功脱身' in out or '逃跑失败' in out)


class TestTradeMode(unittest.TestCase):
    def test_market_commands(self):
        _code, out = play('2,info,quit')
        self.assertIn('东市 · 开市', out)
        self.assertIn('今日卖出价', out)

    def test_idle_trader_ends_broke(self):
        _code, out = play('2,next,next,next,1,quit')
        self.assertIn('东市 · 收市', out)
        self.assertIn('结局 · 空车回程', out)

    def test_good_call_ends_merchant(self):
        inputs = '2,buy tea 2,sell tea 2,next,buy salt 5,sell salt 5,next,buy cloth 8,sell cloth 8,next,1,quit'
        _code, out = play(inputs)
        self.assertIn('结局 · 半间铺面', out)


class TestDialogueMode(unittest.TestCase):
    def _to_crossing(self):
        # 战斗有随机：先打到分出胜负，赢了才走得到渡口
        code, out = play('1,1,' + ','.join(['a'] * 14) + ',1,topics,ask 1,ask 2,end,1,quit')
        return out

    def test_dialogue_topics(self):
        out = self._to_crossing()
        if '渡口 · 老渡工' in out:
            self.assertIn('老渡工', out)
            self.assertIn('船是老的', out)
        else:
            self.assertIn('山道', out)      # 战败分支也必须是合法流程

    def test_dialogue_end_transitions(self):
        code, out = play('1,1,' + ','.join(['a'] * 14) + ',1,end,2,quit')
        self.assertTrue('渡口 · 该走了' in out or '山道' in out)


class TestDiaryMode(unittest.TestCase):
    def test_list_and_reread(self):
        _code, out = play('3,1,back,quit')
        self.assertIn('屋里 · 半页札记', out)
        self.assertIn('可重读的篇目', out)
        self.assertIn('村口 · 启程', out)

    def test_back_returns_to_on_exit(self):
        _code, out = play('3,back,quit')
        self.assertIn('村口 · 启程', out)


class TestCommands(unittest.TestCase):
    def test_stats(self):
        _code, out = play('stats,quit')
        self.assertIn('HP', out)
        self.assertIn('背包', out)

    def test_achievements(self):
        _code, out = play('achievements,quit')
        self.assertIn('第一头狼', out)

    def test_save_slots_load(self):
        _code, out = play('1,save e2e,slots,load e2e,quit')
        self.assertIn('已保存到存档位 e2e', out)
        self.assertIn('已读取存档位 e2e', out)

    def test_load_missing_slot_is_safe(self):
        code, out = play('load nosuchslot,quit')
        self.assertEqual(code, 0)
        self.assertIn('读取存档 nosuchslot 失败', out)

    def test_help(self):
        _code, out = play('help,quit')
        self.assertIn('内置命令', out)

    def test_quit_exit_code(self):
        code, out = play('quit')
        self.assertEqual(code, 0)
        self.assertIn('游戏已退出', out)


class TestEndings(unittest.TestCase):
    def test_settlement_page_can_restart(self):
        code, out = play('2,next,next,next,1')
        self.assertEqual(code, 0)
        self.assertIn('结局 · 空车回程', out)
        self.assertIn('再来一次', out)

    def test_restart_returns_to_entry(self):
        _code, out = play('2,next,next,next,1,1,quit')
        self.assertGreaterEqual(out.count('村口 · 启程'), 2)


class TestSdkExternalProject(unittest.TestCase):
    def test_loop_and_true_ending(self):
        code, out = run_fixture('1,1,1,1,2,1,2')
        self.assertIn('清晨', out)
        self.assertIn('（完）', out)
        self.assertIn('结局 · 摊牌', out)

    def test_loop_keep_domain(self):
        _code, out = run_fixture('1,1,1,1')
        self.assertGreaterEqual(out.count('还剩 3 次机会'), 2,
                                '行动力应每轮复原、线索跨轮保留')


if __name__ == '__main__':
    unittest.main(verbosity=2)
