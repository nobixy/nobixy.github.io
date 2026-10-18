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
        for href, number, label in (("/", "01", "HOME"), ("/writing/", "02", "WRITING"))
    )
    home = "" if path == "/" else "/"
    menu = "".join(
        f'<li><a href="{home}{anchor}"><span aria-hidden="true">{icon}</span>{label}</a></li>'
        for anchor, icon, label in (("#hello", "◆", "Hello / About"), ("#learning", "◇", "Study log"),
                                    ("#experience", "◆", "Experience"))
    )
    elsewhere = "".join(
        f'<li><a href="{esc(link["href"], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(link["label"])} ↗</a></li>'
        for link in data["profile"].get("links", [])
    )
    updated = esc(data.get("updated", ""))
    subjects = " <span>+</span> ".join(esc(course["name"]) for course in data.get("learning", {}).get("open", []))
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
<meta name="theme-color" content="#e8f1fb">
<link rel="alternate" type="application/rss+xml" title="{esc(name)}: writing" href="/feed.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 fill=%22%2324366e%22/%3E%3Cpath d=%22M16 3l2.6 9.4L28 15l-9.4 2.6L16 27l-2.6-9.4L4 15l9.4-2.6z%22 fill=%22%23ffd3e3%22/%3E%3C/svg%3E">
<link rel="stylesheet" href="/style.css?v={STYLE_VERSION}">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="grain" aria-hidden="true"></div>
<div class="site-shell">
<div class="utility-bar"><span>☆ WELCOME TO MY LITTLE CORNER OF THE INTERNET ☆</span><span>LAST UPDATED: {updated}</span></div>
<header class="site">
  <div class="header-identity">
  <div class="brand-line"><span class="brand-spark" aria-hidden="true">✦</span><a class="brand" href="/" aria-label="{esc(name)} home">NOBIXY<span>'S ROOM</span></a><span class="brand-spark" aria-hidden="true">✦</span></div>
  <p>the personal homepage of {esc(name)} <span aria-hidden="true">✳</span> learning, making, writing</p>
  </div>
  <div class="header-badges" aria-label="Site badges"><span>EST. 2026</span><span>TEXT FIRST</span><span>ALWAYS UNDER CONSTRUCTION</span></div>
</header>
<nav class="top-nav" aria-label="Main navigation">{nav}<a href="/feed.xml"><span>03</span>RSS FEED</a><a href="https://github.com/nobixy"><span>04</span>GITHUB ↗</a></nav>
<div class="site-layout">
<aside class="sidebar" aria-label="Site directory">
  <section class="side-box"><h2>★ MENU / INDEX</h2><ul class="menu-list">{menu}<li><a href="/writing/"><span aria-hidden="true">◇</span>Writing archive</a></li><li><a href="/feed.xml"><span aria-hidden="true">◆</span>RSS feed</a></li></ul></section>
  <section class="side-box status-box"><h2>★ NOW / STATUS</h2><p>Studying EECS one lesson at a time.</p><p class="tiny-label">CURRENTLY OPEN</p><p class="open-subjects">{subjects or "More soon"}</p><a href="{home}#learning">View study progress →</a></section>
  <section class="side-box links-box"><h2>★ LINKS / ELSEWHERE</h2><ul>{elsewhere}<li><a href="{esc(data.get("learning", {}).get("curriculum_href", "https://github.com/nobixy"), quote=True)}">Study curriculum ↗</a></li></ul></section>
  <div class="web-stamps" aria-label="Web badges"><span>NO ADS</span><span>RSS READY</span><span>BEST VIEWED CURIOUS</span></div>
</aside>
<main id="main" class="{page_class}">
{body}
</main>
</div>
<footer class="site"><p>✳ Thanks for visiting {esc(name)}'s homepage. Come back soon!</p><p>LAST SYNC: {updated} &nbsp; / &nbsp; <a href="/">HOME</a> &nbsp; / &nbsp; <a href="/writing/">WRITING</a></p></footer>
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
    profile, learning = data["profile"], data.get("learning") or {}
    links = "".join(
        f'<a href="{esc(link["href"], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(link["label"])} ↗</a>'
        for link in profile.get("links", [])
    )
    first = profile["name"].split()[0]
    updates = [f'<li><time datetime="{esc(data.get("updated", ""))}">{esc(data.get("updated", ""))}</time><span>Resume and study data synced.</span></li>']
    updates.extend(
        f'<li><time datetime="{post["date"]}">{post["date"]}</time><a href="/{post["slug"]}/">New writing: {esc(post["title"])}</a></li>'
        for post in posts[:3]
    )
    out = [f"""<section class="welcome-panel" id="hello" aria-labelledby="hello-title">
  <div class="section-bar"><span>01 // WELCOME</span><span>PERSONAL SITE ✦ EST. 2026</span></div>
  <div class="welcome-content"><div class="welcome-copy"><p class="welcome-label">HI THERE! &nbsp; / &nbsp; WELCOME TO MY HOMEPAGE</p>
    <h1 id="hello-title">Hello! <span>I'm {esc(first)}.</span></h1>
    <p class="headline">{esc(profile["headline"])}</p>
    <p>{esc(profile["summary"])}</p>
    <div class="quick-links"><a href="#learning">▸ WHAT I'M STUDYING</a><a href="/writing/">▸ READ MY WRITING</a>{links}</div>
  </div><div class="welcome-art" aria-hidden="true"><div class="pixel-monitor"><div class="monitor-screen"><span>^_^</span><small>HELLO, WEB!</small></div><div class="monitor-stand"></div></div><span class="art-caption">✦ CURRENTLY BUILDING A LIFE IN TECH ✦</span></div></div>
</section>
<div class="notice-strip"><strong>NEWS FLASH!</strong><span>Learning in public, one lesson and one page at a time.</span><span>✿ ✿ ✿</span></div>
<div class="home-columns"><div class="content-main">
<section class="panel updates-panel"><div class="section-bar"><span>02 // SITE UPDATES</span><span>UPDATE LOG</span></div><div class="panel-body"><h2>What's new <span aria-hidden="true">✳</span></h2><ul class="updates">{"".join(updates)}</ul></div></section>"""]

    if learning:
        open_courses = "".join(
            f'<li><span>{esc(course["name"])}</span>{bar(course["done"], course["total"])}<span class="num">{course["done"]}/{course["total"]}</span></li>'
            for course in learning.get("open", [])
        )
        phases = "".join(
            f'<li><span>{esc(phase["name"])}</span>{bar(phase["done"], phase["total"])}<span class="num">{phase["courses_done"]}/{phase["courses"]} courses</span></li>'
            for phase in learning.get("phases", [])
        )
        out.append(f"""<section class="panel learning-panel" id="learning"><div class="section-bar"><span>03 // STUDY DESK</span><span>IN PROGRESS</span></div><div class="panel-body">
<h2>Now learning <span aria-hidden="true">✳</span></h2><p>I'm working through a self-built electrical engineering and computer science curriculum: {learning["courses"]} courses from foundations through systems, hardware and a capstone. <a href="{esc(learning["curriculum_href"], quote=True)}">See the full curriculum ↗</a></p>
<div class="stat-row"><div><strong>{learning["done"]:,}<small> / {learning["total"]:,}</small></strong><span>LESSONS COMPLETE</span></div><div><strong>{learning["courses_done"]}<small> / {learning["courses"]}</small></strong><span>COURSES FINISHED</span></div></div>
<h3 class="subheading">OPEN COURSES</h3><ul class="progress">{open_courses}</ul>
<details class="phase-details"><summary>SHOW ALL STUDY PHASES <span aria-hidden="true">[ + ]</span></summary><ul class="progress">{phases}</ul></details>
</div></section>""")

    jobs = "".join(
        f'<div class="job"><div class="job-heading"><h3>{esc(job["role"])}</h3><span class="period">{esc(job["period"])}</span></div>'
        + (f'<p>{esc(job["note"])}</p>' if job.get("note") else "")
        + ("<ul>" + "".join(f"<li>{esc(bullet)}</li>" for bullet in job["bullets"]) + "</ul>" if job.get("bullets") else "")
        + "</div>" for job in profile.get("experience", [])
    )
    out.append(f'<section class="panel experience-panel" id="experience"><div class="section-bar"><span>04 // WORK HISTORY</span><span>EXPERIENCE</span></div><div class="panel-body"><h2>Experience <span aria-hidden="true">✳</span></h2><div class="jobs">{jobs}</div></div></section>')
    out.append('</div><aside class="content-rail" aria-label="More about Joseph">')

    if posts:
        out.append(f'<section class="panel writing-panel"><div class="section-bar"><span>THE NOTEBOOK</span><span>NEW!</span></div><div class="panel-body"><h2>Recent writing</h2>{post_list(posts, 3)}<a class="text-link" href="/writing/">→ ALL POSTS</a></div></section>')

    skills = "".join(f'<div><dt>{esc(skill["label"])}</dt><dd>{esc(skill["text"])}</dd></div>' for skill in profile.get("skills", []))
    out.append(f'<section class="panel skills-panel"><div class="section-bar"><span>TOOLBOX.TXT</span><span>✱</span></div><div class="panel-body"><h2>What I know</h2><dl class="skills">{skills}</dl></div></section>')

    achievements = data.get("achievements") or []
    if achievements:
        items = "".join(f'<li><span class="kind">{esc(item["kind"])}</span>{esc(item["text"])}</li>' for item in achievements)
        out.append(f'<section class="panel achievements-panel"><div class="section-bar"><span>COMPLETED WORK</span><span>★</span></div><div class="panel-body"><h2>Finished things</h2><ul class="ach">{items}</ul></div></section>')

    if profile.get("education"):
        education = "".join(f'<li>{esc(item)}</li>' for item in profile["education"])
        out.append(f'<section class="panel education-panel"><div class="section-bar"><span>FILE CABINET</span><span>▤</span></div><div class="panel-body"><h2>Education &amp; certificates</h2><ul>{education}</ul></div></section>')
    out.append('</aside></div>')
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
