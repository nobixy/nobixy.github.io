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
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

from safe_markdown import render

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs"
STYLE_VERSION = hashlib.sha256((ROOT / "style.css").read_bytes()).hexdigest()[:12]
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
            v = v[1:-1].replace('\\"', '"')
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
                      "html": render(body),
                      "minutes": max(1, round(words / WPM))})
    posts.sort(key=lambda x: x["date"], reverse=True)
    return posts


def page(title: str, body: str, data: dict, *, description: str = "", path: str = "/", page_class: str = "") -> str:
    name = data["profile"]["name"]
    full = title if title == name else f"{title} · {name}"
    desc = description or data["profile"].get("headline", "")
    nav = "".join(
        f'<a href="{href}" {"aria-current=\"page\"" if path == href else ""}>'
        f'<span>{number}</span>{label}</a>'
        for href, number, label in (("/", "01", "Home"), ("/writing/", "02", "Writing"))
    )
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
<meta name="theme-color" content="#15142f">
<link rel="alternate" type="application/rss+xml" title="{esc(name)}: writing" href="/feed.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%227%22 fill=%22%2315142f%22/%3E%3Cpath d=%22M16 3l2.6 9.4L28 15l-9.4 2.6L16 27l-2.6-9.4L4 15l9.4-2.6z%22 fill=%22%23ecff79%22/%3E%3C/svg%3E">
<link rel="stylesheet" href="/style.css?v={STYLE_VERSION}">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="grain" aria-hidden="true"></div>
<div class="site-shell">
<div class="utility-bar"><span><span class="live-dot" aria-hidden="true"></span> PERSONAL INTERNET SPACE</span><span>EST. 2026 <span aria-hidden="true">✳</span> STILL IN PROGRESS</span></div>
<header class="site">
  <a class="brand" href="/" aria-label="{esc(name)} home"><span class="brand-icon" aria-hidden="true">✳</span><span>nobixy<span class="brand-suffix">.github.io</span></span></a>
  <nav aria-label="Main navigation">{nav}<a href="/feed.xml"><span>03</span>RSS</a></nav>
</header>
<div class="signal-strip"><span>✳ A LITTLE CORNER OF THE WEB</span><span>STUDYING / WRITING / FIGURING IT OUT</span><span aria-hidden="true">✳ ✳ ✳</span></div>
<main id="main" class="{page_class}">
{body}
</main>
<footer class="site"><div><span class="footer-star" aria-hidden="true">✳</span><strong>Thanks for stopping by.</strong><span>Built by {esc(name)}. Last synced {esc(data.get("updated", ""))}.</span></div><div class="footer-links"><a href="/">Home</a><a href="/writing/">Writing</a><a href="https://github.com/nobixy">GitHub ↗</a></div></footer>
</div>
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
        f'<li><a class="post-link" href="/{p["slug"]}/"><span class="post-number">{i:02d}</span>'
        f'<span class="post-copy"><strong>{esc(p["title"])}</strong>'
        + (f'<span>{esc(p["description"])}</span>' if p["description"] else "")
        + f'</span><span class="post-side"><time datetime="{p["date"]}">{p["date"]:%b} {p["date"].day}, {p["date"]:%Y}</time><span aria-hidden="true">↗</span></span></a></li>'
        for i, p in enumerate(items, 1)) + "</ul>"


def resume_html(data: dict, posts: list[dict]) -> str:
    p, learn = data["profile"], data.get("learning") or {}
    links = "".join(f'<a href="{esc(l["href"], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(l["label"])} ↗</a>' for l in p.get("links", []))
    learning_action = '<a class="button button-ghost" href="#learning">What I\'m learning <span aria-hidden="true">↓</span></a>' if learn else ''
    first, _, last = p["name"].partition(" ")
    out = [f"""<section class="hero" aria-labelledby="hero-title">
  <div class="hero-copy">
    <p class="eyebrow"><span aria-hidden="true">✳</span> HI, YOU FOUND MY CORNER OF THE INTERNET</p>
    <h1 id="hero-title"><span>{esc(first)}</span><span>{esc(last or first)}<i aria-hidden="true">✳</i></span></h1>
    <p class="hero-headline">{esc(p["headline"])}</p>
    <div class="hero-actions"><a class="button button-primary" href="/writing/">Read my writing <span aria-hidden="true">↗</span></a>{learning_action}</div>
    <div class="hero-contact">{f'<span class="location">⌁ {esc(p["location"])}</span>' if p.get("location") else ''}{links}</div>
  </div>
  <div class="about-window">
    <div class="window-title"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>about_me.txt</span><span aria-hidden="true">✕</span></div>
    <div class="about-content"><div class="orbit" aria-hidden="true"><span>JN</span><i>✳</i></div><p>{esc(p["summary"])}</p><span class="window-status"><span class="live-dot" aria-hidden="true"></span> CURRENTLY LEARNING IN PUBLIC</span></div>
  </div>
  <div class="hero-footer"><span>SCROLL TO EXPLORE <span aria-hidden="true">↓</span></span><span>NO POP-UPS. JUST IDEAS. <span aria-hidden="true">✳</span></span></div>
</section><div class="content-grid"><div class="content-main">"""]

    if learn:
        cur = "".join(f'<li><span>{esc(c["name"])}</span>{bar(c["done"], c["total"])}<span class="num">{c["done"]}/{c["total"]}</span></li>'
                      for c in learn.get("open", []))
        phases = "".join(f'<li><span>{esc(ph["name"])}</span>{bar(ph["done"], ph["total"])}<span class="num">{ph["courses_done"]}/{ph["courses"]} courses</span></li>'
                         for ph in learn.get("phases", []))
        out.append(f"""<section class="panel learning-panel" id="learning">
  <div class="panel-top"><span>01 / THE CURRENT QUEST</span><span aria-hidden="true">✳ ✳ ✳</span></div>
  <div class="panel-body"><div class="section-title"><div><p class="eyebrow">ON THE WORKBENCH</p><h2>Now learning<span class="pink-star" aria-hidden="true">✳</span></h2></div><span class="pill">LIVE PROGRESS</span></div>
  <p class="learning-intro">I'm working through a self-built electrical engineering and computer science curriculum: {learn["courses"]} courses on one path, from foundations through systems, hardware and a capstone. <a href="{esc(learn["curriculum_href"], quote=True)}">Explore the curriculum ↗</a></p>
  <div class="stat-row"><div><strong>{learn["done"]:,}</strong><span>lessons complete <small>/ {learn["total"]:,} total</small></span></div><div><strong>{learn["courses_done"]}</strong><span>courses finished <small>/ {learn["courses"]} total</small></span></div></div>
  {f'<div class="progress-wrap"><h3>Open courses <span>IN MOTION</span></h3><ul class="progress">{cur}</ul></div>' if cur else ''}
  <details class="phase-details"><summary>See the full journey <span aria-hidden="true">＋</span></summary><ul class="progress">{phases}</ul></details>
  </div></section>""")

    jobs = "".join(
        f'<div class="job"><div class="job-heading"><h3>{esc(j["role"])}</h3><p class="period">{esc(j["period"])}</p></div>'
        + (f'<p>{esc(j["note"])}</p>' if j.get("note") else "")
        + ("<ul>" + "".join(f"<li>{esc(b)}</li>" for b in j["bullets"]) + "</ul>" if j.get("bullets") else "") + "</div>"
        for j in p.get("experience", []))
    out.append('<section class="panel experience-panel"><div class="panel-top"><span>02 / THE REAL-WORLD STUFF</span><span aria-hidden="true">✳ ✳ ✳</span></div><div class="panel-body"><p class="eyebrow">THINGS I HAVE DONE</p><h2>Experience<span class="pink-star" aria-hidden="true">✳</span></h2><div class="jobs">' + jobs + '</div></div></section>')
    out.append('</div><aside class="content-rail" aria-label="More about Joseph">')

    if posts:
        out.append(f'<section class="panel writing-panel"><div class="panel-top"><span>THE NOTEBOOK</span><span aria-hidden="true">↗</span></div><div class="panel-body"><p class="eyebrow">FRESH FROM THE BRAIN</p><h2>Writing</h2>{post_list(posts, 3)}<a class="text-link" href="/writing/">Visit the whole archive <span aria-hidden="true">→</span></a></div></section>')

    skills = "".join(f'<div><dt>{esc(s["label"])}</dt><dd>{esc(s["text"])}</dd></div>' for s in p.get("skills", []))
    out.append('<section class="panel skills-panel"><div class="panel-top"><span>THE TOOLBOX</span><span aria-hidden="true">✳</span></div><div class="panel-body"><p class="eyebrow">WHAT I BRING</p><h2>Skills</h2><dl class="skills">' + skills + '</dl></div></section>')

    ach = data.get("achievements") or []
    if ach:
        achievements = "".join(f'<li><span class="kind">{esc(a["kind"])}</span>{esc(a["text"])}</li>' for a in ach)
        out.append('<section class="panel achievements-panel"><div class="panel-top"><span>UNLOCKED</span><span aria-hidden="true">★</span></div><div class="panel-body"><p class="eyebrow">PROOF OF WORK</p><h2>Completed work</h2><p class="muted">Added when the learning checks are recorded.</p><ul class="ach">' + achievements + '</ul></div></section>')

    if p.get("education"):
        education = "".join(f'<li>{esc(e)}</li>' for e in p["education"])
        out.append('<section class="panel education-panel"><div class="panel-top"><span>THE PAPER TRAIL</span><span aria-hidden="true">✳</span></div><div class="panel-body"><p class="eyebrow">FORMAL BITS</p><h2>Education &amp; certifications</h2><ul>' + education + '</ul></div></section>')
    out.append("</aside></div>")
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
    shutil.copy(ROOT / "grain.svg", OUT / "grain.svg")
    write("index.html", page(data["profile"]["name"], resume_html(data, posts), data, page_class="home-page"))
    intro = "".join(f"<p>{esc(x)}</p>" for x in settings.get("writing_intro", []))
    writing_body = f'''<section class="page-heading"><p class="eyebrow">HOME / WRITING / THE ARCHIVE</p><h1>Things I put <em>into words.</em><span aria-hidden="true">✳</span></h1><p>Study notes, short stories, and thoughts in progress. This is where they land.</p></section>
<section class="panel archive-panel"><div class="panel-top"><span>OPEN FOLDER / WRITING</span><span>{len(posts):02d} FILES</span></div><div class="panel-body"><div class="archive-intro">{intro}</div>{post_list(posts)}</div></section>'''
    write("writing/index.html", page("Writing", writing_body, data, path="/writing/", page_class="archive-page",
                                     description="What I'm learning, written up."))
    for p in posts:
        others = [other for other in posts if other["slug"] != p["slug"]][:2]
        related = post_list(others) if others else '<p>More writing is on the way.</p>'
        body = f'''<div class="article-grid"><div><a class="back-link" href="/writing/">← BACK TO THE ARCHIVE</a>
<article class="post-panel"><header class="post-header"><p class="eyebrow">A NOTE FROM THE WORKBENCH <span aria-hidden="true">✳</span></p><h1>{esc(p["title"])}</h1><p class="post-meta"><time datetime="{p["date"]}">{p["date"]:%B} {p["date"].day}, {p["date"]:%Y}</time><span aria-hidden="true">✳</span>{p["minutes"]} min read</p></header>
<div class="post-content">{p["html"]}</div><footer class="post-end"><span aria-hidden="true">✳</span><p>Thanks for reading.</p><a href="/writing/">See all writing →</a></footer></article></div>
<aside class="article-aside" aria-label="More writing"><div class="panel"><div class="panel-top"><span>KEEP EXPLORING</span><span aria-hidden="true">↗</span></div><div class="panel-body"><p class="eyebrow">MORE FROM THIS CORNER</p>{related}</div></div><div class="aside-note">✳ MADE ON THE INTERNET, WITH CARE.</div></aside></div>'''
        write(f'{p["slug"]}/index.html', page(p["title"], body, data, description=p["description"], path=f'/{p["slug"]}/', page_class="article-page"))
    write("feed.xml", feed(posts, data))
    print(f"built docs/: resume + {len(posts)} post(s)")


if __name__ == "__main__":
    build()
