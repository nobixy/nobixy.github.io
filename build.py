#!/usr/bin/env python3
"""Build the site into docs/ (GitHub Pages serves main:/docs).

Sources:
  data/resume.json   the living resume, exported by the study dashboard
  posts/*.md         published writing: YYYY-MM-DD-slug.md with title/date/description front matter
  drafts/            git-ignored; never built

Run: python3 build.py   (preview: python3 -m http.server -d docs 8000)
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import shutil
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs"
SITE_URL = "https://nobixy.github.io"
WPM = 220

esc = html.escape


def front_matter(text: str) -> tuple[dict, str]:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] == '"':
            v = v[1:-1]
        meta[k.strip()] = v
    return meta, text[m.end():]


def load_posts() -> list[dict]:
    posts = []
    for p in sorted((ROOT / "posts").glob("*.md")):
        m = re.match(r"^(\d{4}-\d{2}-\d{2})-(.+)\.md$", p.name)
        if not m:
            continue
        meta, body = front_matter(p.read_text(encoding="utf-8"))
        words = len(body.split())
        posts.append({"slug": m.group(2), "date": dt.date.fromisoformat(meta.get("date") or m.group(1)),
                      "title": meta.get("title") or m.group(2), "description": meta.get("description", ""),
                      "html": markdown.markdown(body, extensions=["extra", "smarty"]),
                      "minutes": max(1, round(words / WPM))})
    posts.sort(key=lambda x: x["date"], reverse=True)
    return posts


def page(title: str, body: str, data: dict, *, description: str = "", path: str = "/") -> str:
    name = data["profile"]["name"]
    full = title if title == name else f"{title} · {name}"
    desc = description or data["profile"].get("headline", "")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{SITE_URL}{path}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{SITE_URL}{path}">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/rss+xml" title="{esc(name)}: writing" href="/feed.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%232f7d4f%22/%3E%3Ctext x=%2216%22 y=%2222%22 font-family=%22sans-serif%22 font-size=%2216%22 font-weight=%22700%22 fill=%22white%22 text-anchor=%22middle%22%3EJN%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site">
  <a class="name" href="/">{esc(name)}</a>
  <nav><a href="/">Resume</a><a href="/writing/">Writing</a><a href="/feed.xml">RSS</a></nav>
</header>
<main>
{body}
</main>
<footer class="site">Updated {esc(data.get("updated", ""))} from my study dashboard. · <a href="https://github.com/nobixy">GitHub</a></footer>
</body>
</html>
"""


def bar(done: int, total: int) -> str:
    pct = 0 if not total else min(100, done * 100 / total)
    return f'<span class="bar" role="img" aria-label="{done} of {total}"><span style="width:{pct:.1f}%"></span></span>'


def post_list(posts: list[dict], limit: int | None = None) -> str:
    items = posts[:limit] if limit else posts
    if not items:
        return '<p class="muted">First posts are on the way.</p>'
    return '<ul class="posts">' + "".join(
        f'<li><a href="/{p["slug"]}/">{esc(p["title"])}</a>'
        f'<time datetime="{p["date"]}">{p["date"]:%b} {p["date"].day}, {p["date"]:%Y}</time>'
        + (f'<p>{esc(p["description"])}</p>' if p["description"] else "") + "</li>" for p in items) + "</ul>"


def resume_html(data: dict, posts: list[dict]) -> str:
    p, learn = data["profile"], data.get("learning") or {}
    links = " · ".join(f'<a href="{esc(l["href"])}">{esc(l["label"])}</a>' for l in p.get("links", []))
    out = [f'<section class="hero"><h1>{esc(p["name"])}</h1><p class="headline">{esc(p["headline"])}</p>'
           + (f'<p class="contact">{esc(p["location"])}{" · " if p.get("location") and links else ""}{links}</p>' if p.get("location") or links else "")
           + f'<p>{esc(p["summary"])}</p></section>']

    if learn:
        cur = "".join(f'<li><span>{esc(c["name"])}</span>{bar(c["done"], c["total"])}<span class="num">{c["done"]}/{c["total"]}</span></li>'
                      for c in learn.get("open", []))
        phases = "".join(f'<li><span>{esc(ph["name"])}</span>{bar(ph["done"], ph["total"])}<span class="num">{ph["courses_done"]}/{ph["courses"]} courses</span></li>'
                         for ph in learn.get("phases", []))
        out.append(f"""<section><h2>Now learning</h2>
<p>I'm working through a self-built electrical engineering and computer science curriculum: {learn["courses"]} courses on one path, from foundations through systems, hardware and a capstone. The whole curriculum is public: <a href="{esc(learn["curriculum_href"])}">{esc(learn["curriculum_label"])}</a>.</p>
<p class="stat"><strong>{learn["done"]:,}</strong> of {learn["total"]:,} lessons complete · <strong>{learn["courses_done"]}</strong> of {learn["courses"]} courses finished</p>
{f'<h3>Open courses</h3><ul class="progress">{cur}</ul>' if cur else ''}
<details><summary>Progress by phase</summary><ul class="progress">{phases}</ul></details>
</section>""")

    ach = data.get("achievements") or []
    if ach:
        out.append('<section><h2>Completed work</h2><p class="muted">Each item is added automatically once its labs and completion checks are recorded.</p><ul class="ach">'
                   + "".join(f'<li><span class="kind">{esc(a["kind"])}</span> {esc(a["text"])}</li>' for a in ach) + "</ul></section>")

    if posts:
        out.append(f'<section><h2>Writing</h2>{post_list(posts, 3)}'
                   + (f'<p><a href="/writing/">All {len(posts)} posts →</a></p>' if len(posts) > 3 else "") + "</section>")

    out.append('<section><h2>Skills</h2><dl class="skills">' + "".join(
        f'<div><dt>{esc(s["label"])}</dt><dd>{esc(s["text"])}</dd></div>' for s in p.get("skills", [])) + "</dl></section>")
    out.append('<section><h2>Experience</h2>' + "".join(
        f'<div class="job"><h3>{esc(j["role"])}</h3><p class="period">{esc(j["period"])}</p>'
        + (f'<p>{esc(j["note"])}</p>' if j.get("note") else "")
        + "<ul>" + "".join(f"<li>{esc(b)}</li>" for b in j.get("bullets", [])) + "</ul></div>"
        for j in p.get("experience", [])) + "</section>")
    if p.get("education"):
        out.append('<section><h2>Education &amp; certifications</h2><ul>' + "".join(f"<li>{esc(e)}</li>" for e in p["education"]) + "</ul></section>")
    return "\n".join(out)


def feed(posts: list[dict], data: dict) -> str:
    def rfc822(d: dt.date) -> str:
        return dt.datetime(d.year, d.month, d.day, 12, tzinfo=dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    items = "".join(f"""<item><title>{esc(p["title"])}</title><link>{SITE_URL}/{p["slug"]}/</link><guid>{SITE_URL}/{p["slug"]}/</guid><pubDate>{rfc822(p["date"])}</pubDate><description>{esc(p["html"])}</description></item>""" for p in posts)
    name = esc(data["profile"]["name"])
    return f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>{name}: writing</title><link>{SITE_URL}/writing/</link><description>{name} writes about learning EECS.</description>{items}</channel></rss>\n'


def write(rel: str, text: str) -> None:
    f = OUT / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text, encoding="utf-8")


def build() -> None:
    data = json.loads((ROOT / "data" / "resume.json").read_text(encoding="utf-8"))
    posts = load_posts()
    try:
        settings = json.loads((ROOT / "site.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        settings = {}
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    write(".nojekyll", "")
    shutil.copy(ROOT / "style.css", OUT / "style.css")
    write("index.html", page(data["profile"]["name"], resume_html(data, posts), data))
    intro = "".join(f"<p>{esc(x)}</p>" for x in settings.get("writing_intro", []))
    write("writing/index.html", page("Writing", f'<h1>Writing</h1><div class="intro">{intro}</div>{post_list(posts)}', data, path="/writing/",
                                     description="What I'm learning, written up."))
    for p in posts:
        body = (f'<article><h1>{esc(p["title"])}</h1><p class="meta"><time datetime="{p["date"]}">{p["date"]:%B} {p["date"].day}, {p["date"]:%Y}</time> · {p["minutes"]} min read</p>'
                f'{p["html"]}</article><p class="back"><a href="/writing/">← All writing</a></p>')
        write(f'{p["slug"]}/index.html', page(p["title"], body, data, description=p["description"], path=f'/{p["slug"]}/'))
    write("feed.xml", feed(posts, data))
    print(f"built docs/: resume + {len(posts)} post(s)")


if __name__ == "__main__":
    build()
