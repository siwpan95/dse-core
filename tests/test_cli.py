"""CLI 接口测试：各子命令的退出码与 --json 契约。

    python -m unittest tests.test_cli -v
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'cli.py')
ENV = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'DSE_MUTE': '1'}


def dse(*args: str) -> tuple[int, str, str]:
    proc = subprocess.run([sys.executable, CLI, *args], cwd=ROOT, env=ENV,
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
    return proc.returncode, proc.stdout or '', proc.stderr or ''


class TestReadOnlyCommands(unittest.TestCase):
    def test_scenes(self):
        code, out, _err = dse('scenes')
        self.assertEqual(code, 0)
        self.assertIn('场景 14 个', out)
        self.assertIn('⚑', out)
        self.assertIn('⚔', out)

    def test_scenes_json(self):
        code, out, _err = dse('scenes', '--json')
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual(len(data), 14)
        start = next(s for s in data if s['id'] == 'start')
        self.assertEqual(start['title'], '村口 · 启程')
        self.assertFalse(start['ending'])
        self.assertTrue(next(s for s in data if s['id'] == 'end-hero')['ending'])

    def test_scenes_single(self):
        code, out, _err = dse('scenes', '--scene', 'wolf-fight')
        self.assertEqual(code, 0)
        self.assertIn('山道 · 遭遇', out)
        self.assertIn('battle', out)

    def test_scenes_unknown_is_error(self):
        code, _out, err = dse('scenes', '--scene', 'nope')
        self.assertEqual(code, 1)
        self.assertIn('不存在', err)

    def test_info_json(self):
        code, out, _err = dse('info', '--json')
        self.assertEqual(code, 0)
        stats = json.loads(out)
        self.assertEqual(stats['scenes'], 14)
        self.assertEqual(stats['endings'], 5)
        self.assertEqual(stats['entry'], 'start')
        self.assertIn('battle', stats['modes'])

    def test_info_text(self):
        code, out, _err = dse('info')
        self.assertEqual(code, 0)
        self.assertIn('场景', out)
        self.assertIn('结局', out)


class TestCheckAndDoctor(unittest.TestCase):
    def test_check_passes(self):
        code, out, _err = dse('check')
        self.assertEqual(code, 0)
        self.assertIn('无错误', out)

    def test_doctor_passes(self):
        code, out, _err = dse('doctor')
        self.assertEqual(code, 0)
        self.assertIn('全部通过', out)
        self.assertIn('内容包可加载', out)


class TestPacks(unittest.TestCase):
    def test_packs_text(self):
        code, out, _err = dse('packs')
        self.assertEqual(code, 0)
        self.assertIn('starter', out)
        self.assertIn('入口', out)

    def test_packs_json(self):
        code, out, _err = dse('packs', '--json')
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual(data[0]['id'], 'starter')
        self.assertEqual(data[0]['entry'], 'start')
        self.assertIn('battle', data[0]['modes'])


class TestNew(unittest.TestCase):
    def tearDown(self):
        target = os.path.join(ROOT, 'content', 'clitest.py')
        if os.path.exists(target):
            os.remove(target)

    def test_generate_from_template(self):
        code, out, _err = dse('new', 'clitest', '--template=hub', '--ns=ctest')
        self.assertEqual(code, 0)
        target = os.path.join(ROOT, 'content', 'clitest.py')
        self.assertTrue(os.path.exists(target))
        with open(target, 'r', encoding='utf-8') as fh:
            src = fh.read()
        self.assertIn("'id': 'clitest'", src)
        self.assertIn('ctest.hub', src)
        self.assertNotIn('__NS__', src)

    def test_rejects_bad_name(self):
        code, _out, err = dse('new', 'Bad Name')
        self.assertEqual(code, 1)
        self.assertIn('不合法', err)

    def test_rejects_unknown_template(self):
        # argparse 的 choices 校验在解析阶段就拦下，退出码是 2（argparse 惯例）
        code, _out, _err = dse('new', 'clitest', '--template=nope')
        self.assertNotEqual(code, 0)


class TestMisc(unittest.TestCase):
    def test_saves(self):
        code, out, _err = dse('saves')
        self.assertEqual(code, 0)
        self.assertTrue('存档位' in out or '暂无存档' in out)

    def test_play_with_input(self):
        code, out, _err = dse('play', '--input', '1,quit', '--quiet')
        self.assertEqual(code, 0)
        self.assertIn('山道 · 林深处', out)

    def test_play_with_entry(self):
        code, out, _err = dse('play', '--entry', 'market', '--input', 'info,quit', '--quiet')
        self.assertEqual(code, 0)
        self.assertIn('东市 · 开市', out)

    def test_unknown_command(self):
        code, _out, _err = dse('nosuchcmd')
        self.assertNotEqual(code, 0)

    def test_help(self):
        code, out, _err = dse('--help')
        self.assertEqual(code, 0)
        self.assertTrue('usage' in out or '用法' in out)   # argparse 输出随 locale 变化

    def test_json_output_goes_to_stdout_only(self):
        # stdout 必须能被 json 解析（诊断走 stderr 的约定不能被破坏）
        code, out, _err = dse('scenes', '--json')
        self.assertEqual(code, 0)
        json.loads(out)


if __name__ == '__main__':
    unittest.main(verbosity=2)
