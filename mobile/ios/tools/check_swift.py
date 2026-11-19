#!/usr/bin/env python3
"""Грубая проверка Swift-файлов: скобки и строки на месте (компилятора в песочнице нет)."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / "App" / "App"


def check(path: pathlib.Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    i = 0
    line = 1
    problems = []
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\n":
            line += 1
            i += 1
            continue
        # комментарии
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            depth = 1
            i += 2
            while i < n and depth:
                if text.startswith("/*", i):
                    depth += 1
                    i += 2
                elif text.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    if text[i] == "\n":
                        line += 1
                    i += 1
            continue
        # строки
        if text.startswith('"""', i):
            i += 3
            while i < n and not text.startswith('"""', i):
                if text[i] == "\n":
                    line += 1
                i += 1
            i += 3
            continue
        if ch == '"':
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\":
                    i += 1
                elif text[i] == "\n":
                    line += 1
                i += 1
            i += 1
            continue
        if ch in "([{":
            stack.append((ch, line))
            i += 1
            continue
        if ch in ")]}":
            if not stack:
                problems.append(f"{path.name}:{line}: лишняя «{ch}»")
            elif stack[-1][0] != pairs[ch]:
                problems.append(f"{path.name}:{line}: «{ch}» закрывает «{stack[-1][0]}» из строки {stack[-1][1]}")
                stack.pop()
            else:
                stack.pop()
            i += 1
            continue
        i += 1
    for ch, ln in stack:
        problems.append(f"{path.name}:{ln}: не закрыта «{ch}»")
    return problems


def main() -> int:
    all_problems = []
    files = sorted(ROOT.glob("*.swift"))
    for f in files:
        all_problems += check(f)
    print(f"проверено файлов: {len(files)}")
    for p in all_problems:
        print(p)
    return 1 if all_problems else 0


if __name__ == "__main__":
    sys.exit(main())
