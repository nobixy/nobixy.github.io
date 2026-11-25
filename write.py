#!/usr/bin/env python3
"""Write and publish without the old Obsidian study dashboard.

  python3 write.py new "My Title" [Kind]   start drafts/my-title.md (git-ignored, never built)
  python3 write.py list                   drafts waiting, plus a few checks
  python3 write.py publish my-title       drafts/my-title.md -> posts/YYYY-MM-DD-my-title.md, build,
                                          commit, then ask before pushing (every push is public)

Kind is one of the labels on the Writing page (Story, Study notes, Essay, Personal, or a new one).
"""
from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DRAFTS, POSTS, SITE = ROOT / "drafts", ROOT / "posts", ROOT / "site.json"
PHONE = re.compile(r"\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}")


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower().replace("'", "").replace("’", "")).strip("-")


def checks(text: str) -> list[str]:
    """Advice, never a gate (except a phone number, which never goes public)."""
    meta, _, body = text.partition("\n---\n")
    out, words = [], len(body.split())
    if 'description: ""' in meta or "description:" not in meta:
        out.append("No one-line description: it shows in the list and in link previews.")
    if words < 150:
        out.append(f"Only {words} words. Fine for a note, short for a post.")
    if re.search(r"\b(TODO|TK|XXX)\b", body):
        out.append("There's a TODO left in.")
    return out


def new(title: str, kind: str = "Essay") -> None:
    DRAFTS.mkdir(exist_ok=True)
    slug = slugify(title)
    f = DRAFTS / f"{slug}.md"
    if f.exists():
        sys.exit(f"{f} already exists.")
    f.write_text(f'---\ntitle: "{title}"\ndescription: ""\nkind: "{kind}"\n---\n\n', encoding="utf-8")
    print(f"Started {f}\nWhen it's ready: python3 write.py publish {slug}")


def list_drafts() -> None:
    drafts = sorted(DRAFTS.glob("*.md")) if DRAFTS.exists() else []
    if not drafts:
        print("No drafts. Start one: python3 write.py new \"Title\"")
    for f in drafts:
        text = f.read_text(encoding="utf-8")
        print(f"* {f.stem}  ({len(text.split())} words)")
        for c in checks(text):
            print(f"    - {c}")


def publish(slug: str) -> None:
    src = DRAFTS / f"{slug.removesuffix('.md')}.md"
    if not src.exists():
        sys.exit(f"No draft at {src}")
    text = src.read_text(encoding="utf-8")
    if PHONE.search(text):
        sys.exit("Refusing: the draft contains something that looks like a phone number.")
    kind = re.search(r'^kind:\s*"?([^"\n]+)"?\s*$', text, re.M)
    text = re.sub(r'^kind:.*\n', "", text, count=1, flags=re.M)
    today = dt.date.today().isoformat()
    if not re.search(r"^date:", text, re.M):
        text = text.replace("\n---\n", f"\ndate: {today}\n---\n", 1)
    for c in checks(text):
        print(f"  note: {c}")
    dest = POSTS / f"{today}-{src.stem}.md"
    dest.write_text(text, encoding="utf-8")
    if kind:
        site = json.loads(SITE.read_text(encoding="utf-8"))
        site.setdefault("writing_kinds", {})[src.stem] = kind.group(1).strip()
        SITE.write_text(json.dumps(site, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    src.unlink()
    run = lambda *a: subprocess.run(a, cwd=ROOT, check=True)
    run(sys.executable, "build.py")
    run("git", "add", "posts", "docs", "site.json")
    run("git", "commit", "-q", "-m", f"Publish: {src.stem}")
    print(f"Committed {dest.name}. Preview: python3 -m http.server -d docs 8000")
    if input("Push it live to nobixy.github.io now? [y/N] ").strip().lower() == "y":
        run("git", "push", "-q")
        print(f"Live in a minute or two: https://nobixy.github.io/{src.stem}/")
    else:
        print("Not pushed. Run `git push` when you're ready.")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["new"] and len(args) >= 2:
        new(args[1], *(args[2:3]))
    elif args[:1] == ["list"]:
        list_drafts()
    elif args[:1] == ["publish"] and len(args) == 2:
        publish(args[1])
    else:
        print(__doc__)
