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
SCRIPT_VERSION = hashlib.sha256((ROOT / "site.js").read_bytes()).hexdigest()[:12]
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


REPO_URL = "https://github.com/nobixy/nobixy.github.io"


def badges() -> str:
    """88x31 buttons, drawn in CSS. Each one is true and the linked ones go somewhere real."""
    items = (
        ("b-arch", "ARCH", "LINUX USER", "https://archlinux.org/"),
        ("b-py", "PYTHON", "POWERED", "https://www.python.org/"),
        ("b-src", "VIEW", "SOURCE", REPO_URL),
        ("b-rss", "RSS", "XML FEED", "/feed/"),
        ("b-noads", "NO ADS", "NO TRACKING", ""),
        ("b-800", "BEST AT", "800 x 600", ""),
    )
    out = []
    for cls, top, bottom, href in items:
        inner = f'<span>{top}</span><small>{bottom}</small>'
        out.append(f'<a class="b88 {cls}" href="{href}"{" target=\"_blank\" rel=\"noopener noreferrer\"" if href.startswith("http") else ""}>{inner}</a>'
                   if href else f'<span class="b88 {cls}">{inner}</span>')
    return "".join(out)


def odometer(n: int, digits: int = 6) -> str:
    s = str(max(0, n)).zfill(digits)
    return f'<span class="odometer" role="img" aria-label="{n}">' + "".join(f"<b>{d}</b>" for d in s) + "</span>"


def page(title: str, body: str, data: dict, *, description: str = "", path: str = "/", page_class: str = "",
         posts: list | None = None, noindex: bool = False) -> str:
    name = data["profile"]["name"]
    full = title if title == name else f"{title} | {name}"
    desc = description or data["profile"].get("headline", "")
    home = "" if path == "/" else "/"
    posts = posts or []
    menu_items = (
        ("/", "~", "Home"),
        (f"{home}#hello", "*", "About me"),
        (f"{home}#learning", "+", "Study log"),
        (f"{home}#experience", "*", "Experience"),
        ("/writing/", "+", "Writing archive"),
        ("/feed/", "+", "RSS feed"),
    )
    def menu_state(href: str) -> str:
        if href == path:
            return ' aria-current="page"'
        if href == "/writing/" and page_class == "article-page":
            return ' data-parent="current"'
        return ""

    menu = "".join(
        f'<li><a href="{href}"{menu_state(href)}>'
        f'<span aria-hidden="true">{icon}</span>{label}</a></li>'
        for href, icon, label in menu_items
    )
    menu += "".join(
        f'<li><a href="{esc(link["href"], quote=True)}" target="_blank" rel="noopener noreferrer">'
        f'<span aria-hidden="true">-></span>{esc(link["label"])}</a></li>'
        for link in data["profile"].get("links", [])
    )
    updated = esc(us_date(data.get("updated", "")))
    learning = data.get("learning", {})
    subjects = " <span>+</span> ".join(esc(course["name"]) for course in learning.get("open", []))
    news = ["Welcome to my homepage! Thanks for stopping by.",
            f"Now studying: {', '.join(c['name'] for c in learning.get('open', [])) or 'the basics'}."]
    news += [f"NEW WRITING: {p['title']}" for p in posts[:3]]
    news.append(f"Last updated {us_date(data.get('updated', ''))}.")
    ticker = "".join(f"<span>{esc(n)}</span><i aria-hidden=\"true\">*</i>" for n in news)
    url = f"{SITE_URL}{path}"
    return f"""<!doctype html>
<html lang="en" class="dialing-in">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full)}</title>
<meta name="description" content="{esc(desc)}">
{'<meta name="robots" content="noindex">' if noindex else f'<link rel="canonical" href="{url}">'}
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#000080">
<link rel="alternate" type="application/rss+xml" title="{esc(name)}: writing" href="/feed.xml">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 fill=%22%23000080%22/%3E%3Cpath d=%22M16 3l2.6 9.4L28 15l-9.4 2.6L16 27l-2.6-9.4L4 15l9.4-2.6z%22 fill=%22%23ffff00%22/%3E%3C/svg%3E">
<link rel="stylesheet" href="/style.css?v={STYLE_VERSION}">
<script src="/site.js?v={SCRIPT_VERSION}" defer></script>
<noscript><style>html.dialing-in main {{ animation: none; }}</style></noscript>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="browser site-shell" id="top">
<div class="titlebar"><span class="tb-logo" aria-hidden="true">N</span><span class="tb-title">{esc(full)} - Netscape</span><span class="tb-buttons" aria-hidden="true"><b>_</b><b>^</b><b>X</b></span></div>
<div class="menubar" aria-hidden="true"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span><u>G</u>o</span><span><u>B</u>ookmarks</span><span><u>O</u>ptions</span><span><u>D</u>irectory</span><span><u>W</u>indow</span><span class="mb-help"><u>H</u>elp</span></div>
<div class="toolbar">
  <nav class="tb-nav" aria-label="Browser buttons">
    <button type="button" class="tbtn" data-browser="back"><span aria-hidden="true"><</span>Back</button>
    <button type="button" class="tbtn" data-browser="forward"><span aria-hidden="true">></span>Forward</button>
    <a class="tbtn" href="/"><span aria-hidden="true">~</span>Home</a>
    <a class="tbtn" href="{path}"><span aria-hidden="true">@</span>Reload</a>
    <a class="tbtn" href="/writing/"><span aria-hidden="true">/</span>Writing</a>
    <a class="tbtn" href="{REPO_URL}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">=</span>Source</a>
  </nav>
  <div class="throbber" aria-hidden="true"><span>N</span><i></i><i></i><i></i></div>
</div>
<div class="locationbar"><span class="loc-label">Location:</span><span class="loc-field">{esc(url)}</span></div>
<div class="viewport">
<header class="site">
  <div class="header-identity">
  <div class="brand-line"><span class="brand-spark" aria-hidden="true">*</span><a class="brand" href="/" aria-label="{esc(name)} home">NOBIXY<span>'S ROOM</span></a><span class="brand-spark" aria-hidden="true">*</span></div>
  <p>the personal homepage of {esc(name)} <span aria-hidden="true">*</span> learning, making, writing</p>
  </div>
  <div class="header-badges" aria-label="Site badges"><span>EST. 2026</span><span>TEXT FIRST</span><span class="blink">ALWAYS UNDER CONSTRUCTION</span></div>
</header>
<div class="construction" aria-hidden="true"><span>!! UNDER CONSTRUCTION !! PARDON MY DUST !! NEW STUFF EVERY WEEK !!</span></div>
<div class="marquee" role="marquee" aria-label="Site news"><div class="marquee-track"><div class="mq">{ticker}</div><div class="mq" aria-hidden="true">{ticker}</div></div></div>
<div class="site-layout">
<aside class="sidebar" aria-label="Site directory">
  <nav class="side-box side-nav" aria-label="Main navigation"><h2>* Menu</h2><ul class="menu-list">{menu}</ul></nav>
  <section class="side-box status-box"><h2>* What I'm Up To</h2><p>Studying EECS one lesson at a time.</p><p class="tiny-label">LESSONS COMPLETED</p>{odometer(int(learning.get("done", 0)))}<p class="tiny-label">CURRENTLY OPEN</p><p class="open-subjects">{subjects or "More soon"}</p><a href="{home}#learning">View study progress -></a></section>
  <div class="web-stamps" aria-label="Web badges">{badges()}</div>
  <a class="back-top" href="#top">^ BACK TO TOP</a>
</aside>
<main id="main" class="{page_class}">
{body}
</main>
</div>
<footer class="site"><p>* Thanks for visiting {esc(name)}'s homepage. Come back soon!</p><p class="footer-best">Best viewed with Netscape Navigator 3.0 at 800 x 600 | Made on a Linux box</p><p>LAST SYNC: {updated} &nbsp; / &nbsp; <a href="/">HOME</a> &nbsp; / &nbsp; <a href="/writing/">WRITING</a> &nbsp; / &nbsp; <a href="#top">^ TOP</a></p></footer>
</div>
<div class="statusbar" role="status"><span class="sb-lock" aria-hidden="true">#</span><span class="sb-text" id="sb-text">Document: Done</span><span class="sb-meter" aria-hidden="true"><span></span></span><span class="sb-zone">Last updated {updated}</span></div>
</div>
</body>
</html>
"""


def us_date(iso: str) -> str:
    """2026-10-18 -> 10/18/26, the way a 1996 homepage said it. Machines still get ISO in datetime=."""
    try:
        d = dt.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return str(iso)
    return f"{d.month:02d}/{d.day:02d}/{d.year % 100:02d}"


# 6: plain-ASCII punctuation everywhere a page is written (curly quotes, long dashes, ellipses).
ASCII_PUNCT = {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2014": "--", "\u2013": "-",
               "\u2026": "...", "\u00a0": " ", "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"',
               "&mdash;": "--", "&ndash;": "-", "&hellip;": "..."}


def ascii_punct(text: str) -> str:
    for a, b in ASCII_PUNCT.items():
        text = text.replace(a, b)
    return text


def bar(done: int, total: int) -> str:
    pct = 0 if not total else min(100, done * 100 / total)
    return f'<span class="bar" role="img" aria-label="{done} of {total}"><span style="width:{pct:.1f}%"></span></span>'


def post_list(posts: list[dict], limit: int | None = None) -> str:
    items = posts[:limit] if limit else posts
    if not items:
        return '<p class="muted">First posts are on the way.</p>'
    newest = max((p["date"] for p in items), default=None)
    return '<ul class="posts">' + "".join(
        f'<li><a class="post-link" href="/{p["slug"]}/"><span class="post-number">{i:02d}</span>'
        f'<span class="post-copy"><strong>{"<em class=\"new-tag blink\">NEW!</em>" if p["date"] == newest else ""}{esc(p["title"])}</strong>'
        + (f'<span>{esc(p["description"])}</span>' if p["description"] else "")
        + f'</span><span class="post-side"><time datetime="{p["date"]}">{p["date"]:%b} {p["date"].day}, {p["date"]:%Y}</time><span aria-hidden="true">-></span></span></a></li>'
        for i, p in enumerate(items, 1)) + "</ul>"


def resume_html(data: dict, posts: list[dict]) -> str:
    profile, learning = data["profile"], data.get("learning") or {}
    links = "".join(
        f'<a href="{esc(link["href"], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(link["label"])} -></a>'
        for link in profile.get("links", [])
    )
    first = profile["name"].split()[0]
    updates = [f'<li><time datetime="{esc(data.get("updated", ""))}">{esc(us_date(data.get("updated", "")))}</time><span>Resume and study data synced.</span></li>']
    updates.extend(
        f'<li><time datetime="{post["date"]}">{us_date(post["date"].isoformat())}</time><a href="/{post["slug"]}/">New writing: {esc(post["title"])}</a></li>'
        for post in posts[:3]
    )
    out = [f"""<section class="welcome-panel" id="hello" aria-labelledby="hello-title">
  <div class="section-bar"><span>Welcome to my Homepage!</span></div>
  <div class="welcome-content"><div class="welcome-copy"><p class="welcome-label">HI THERE! &nbsp; / &nbsp; WELCOME TO MY HOMEPAGE</p>
    <h1 id="hello-title">Hello, World! <span>I'm {esc(first)}.</span></h1>
    <p class="headline">{esc(profile["headline"])}</p>
    <p>{esc(profile["summary"])}</p>
    <div class="quick-links"><a href="#learning">> WHAT I'M STUDYING</a><a href="/writing/">> READ MY WRITING</a>{links}</div>
  </div><figure class="welcome-art photo-window">
    <div class="pw-title" aria-hidden="true"><span class="pw-icon"></span><span class="pw-name">ME.JPG - Image Viewer</span><span class="pw-buttons"><b>_</b><b>^</b><b>X</b></span></div>
    <div class="pw-menu" aria-hidden="true"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span><u>H</u>elp</span></div>
    <div class="pw-frame"><img src="/avatar.jpg" width="200" height="200" alt="Photo of {esc(profile["name"])}"></div>
    <figcaption class="pw-status"><span>* that's me!</span><span aria-hidden="true">400x400 | 24-bit</span></figcaption>
  </figure></div>
</section>
<div class="home-columns"><div class="content-main">
<section class="panel updates-panel"><div class="section-bar"><span>What's New?!</span></div><div class="panel-body"><ul class="updates">{"".join(updates)}</ul></div></section>"""]

    if learning:
        open_courses = "".join(
            f'<li><span>{esc(course["name"])}</span>{bar(course["done"], course["total"])}<span class="num">{course["done"]}/{course["total"]}</span></li>'
            for course in learning.get("open", [])
        )
        phases = "".join(
            f'<li><span>{esc(phase["name"])}</span>{bar(phase["done"], phase["total"])}<span class="num">{phase["courses_done"]}/{phase["courses"]} courses</span></li>'
            for phase in learning.get("phases", [])
        )
        out.append(f"""<section class="panel learning-panel" id="learning"><div class="section-bar"><span>What I'm Learning</span></div><div class="panel-body">
<p>I'm working through a self-built electrical engineering and computer science curriculum: {learning["courses"]} courses from foundations through systems, hardware and a capstone. <a href="{esc(learning["curriculum_href"], quote=True)}">See the full curriculum -></a></p>
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
    out.append(f'<section class="panel experience-panel" id="experience"><div class="section-bar"><span>My Resume</span></div><div class="panel-body"><div class="jobs">{jobs}</div></div></section>')
    out.append('</div><aside class="content-rail" aria-label="More about Joseph">')

    if posts:
        out.append(f'<section class="panel writing-panel"><div class="section-bar"><span>My Writing</span><span class="blink">NEW!</span></div><div class="panel-body">{post_list(posts, 3)}<a class="text-link" href="/writing/">-> ALL POSTS</a></div></section>')

    skills = "".join(f'<div><dt>{esc(skill["label"])}</dt><dd>{esc(skill["text"])}</dd></div>' for skill in profile.get("skills", []))
    out.append(f'<section class="panel skills-panel"><div class="section-bar"><span>Stuff I Know</span></div><div class="panel-body"><dl class="skills">{skills}</dl></div></section>')

    achievements = data.get("achievements") or []
    if achievements:
        items = "".join(f'<li><span class="kind">{esc(item["kind"])}</span>{esc(item["text"])}</li>' for item in achievements)
        out.append(f'<section class="panel achievements-panel"><div class="section-bar"><span>Stuff I Finished</span></div><div class="panel-body"><ul class="ach">{items}</ul></div></section>')

    if profile.get("education"):
        education = "".join(f'<li>{esc(item)}</li>' for item in profile["education"])
        out.append(f'<section class="panel education-panel"><div class="section-bar"><span>Diplomas &amp; Certificates</span></div><div class="panel-body"><ul>{education}</ul></div></section>')
    out.append('</aside></div>')
    return "\n".join(out)


def not_found_html() -> str:
    return '''<section class="error-desk">
<div class="dialog" role="alertdialog" aria-labelledby="err-title" aria-describedby="err-text">
  <div class="dialog-title"><span>Netscape</span><span class="tb-buttons" aria-hidden="true"><b>X</b></span></div>
  <div class="dialog-body"><span class="dialog-icon" aria-hidden="true">!</span>
    <div><h1 id="err-title">404: File Not Found</h1>
    <p id="err-text">The page <code class="err-path">you asked for</code> could not be found on this server. It may have moved, been deleted, or it's still under construction.</p></div></div>
  <div class="dialog-actions"><a class="dlg-btn" href="/">OK</a><a class="dlg-btn" href="/writing/">Writing</a></div>
</div>
<p class="lost">* LOST IN CYBERSPACE * TRY THE MENU ON THE LEFT *</p>
</section>'''


def feed_page_html(posts: list[dict]) -> str:
    feed_url = f"{SITE_URL}/feed.xml"
    return f'''<section class="page-heading"><p class="eyebrow">You are here: Home &gt; RSS Feed</p><h1>Get new writing by <em>RSS</em><span aria-hidden="true">*</span></h1>
<p>RSS is how the old web did "follow": paste the address below into a feed reader (Feedly, NetNewsWire, Thunderbird, Inoreader...) and every new post shows up there automatically. No account, no algorithm.</p></section>
<section class="panel archive-panel"><div class="panel-top"><span>How to Subscribe</span><span>RSS 2.0</span></div><div class="panel-body">
<div class="feed-box"><span class="loc-label">Feed address:</span><code class="feed-url">{esc(feed_url)}</code><a class="dlg-btn" href="/feed.xml">Open feed.xml</a></div>
<h2>In the feed right now <span aria-hidden="true">*</span></h2>{post_list(posts)}</div></section>'''


def feed(posts: list[dict], data: dict) -> str:
    def rfc822(d: dt.date) -> str:
        return dt.datetime(d.year, d.month, d.day, 12, tzinfo=dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    items = "".join(f"""<item><title>{esc(p["title"])}</title><link>{SITE_URL}/{p["slug"]}/</link><guid>{SITE_URL}/{p["slug"]}/</guid><pubDate>{rfc822(p["date"])}</pubDate><description>{esc(p["html"])}</description></item>""" for p in posts)
    name = esc(data["profile"]["name"])
    return f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>{name}: writing</title><link>{SITE_URL}/writing/</link><description>{name} writes about learning EECS.</description>{items}</channel></rss>\n'


def write(rel: str, text: str) -> None:
    text = ascii_punct(text)
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
    shutil.copy(ROOT / "site.js", OUT / "site.js")
    shutil.copy(ROOT / "avatar.jpg", OUT / "avatar.jpg")
    write("index.html", page(data["profile"]["name"], resume_html(data, posts), data, page_class="home-page", posts=posts))
    intro = "".join(f"<p>{esc(x)}</p>" for x in settings.get("writing_intro", []))
    writing_body = f'''<section class="page-heading"><p class="eyebrow">You are here: Home &gt; Writing</p><h1>Things I put <em>into words.</em><span aria-hidden="true">*</span></h1><p>Study notes, short stories, and thoughts in progress. This is where they land.</p></section>
<section class="panel archive-panel"><div class="panel-top"><span>All My Writing</span><span>{len(posts)} pieces</span></div><div class="panel-body"><div class="archive-intro">{intro}</div>{post_list(posts)}</div></section>'''
    write("writing/index.html", page("Writing", writing_body, data, path="/writing/", page_class="archive-page",
                                     description="What I'm learning, written up.", posts=posts))
    for n, p in enumerate(posts):
        others = [other for other in posts if other["slug"] != p["slug"]][:2]
        newer, older = posts[n - 1] if n else posts[-1], posts[(n + 1) % len(posts)]
        ring = (f'<nav class="webring" aria-label="Writing ring"><p class="ring-name">* NOBIXY\'S WRITING RING *</p>'
                f'<p><a href="/{older["slug"]}/" rel="prev"><< older</a> | <a href="/writing/">index</a> | '
                f'<a href="/{newer["slug"]}/" rel="next">newer >></a></p></nav>') if len(posts) > 1 else ""
        related = post_list(others) if others else '<p>More writing is on the way.</p>'
        body = f'''<div class="article-grid"><div><a class="back-link" href="/writing/"><- BACK TO THE ARCHIVE</a>
<article class="post-panel"><header class="post-header"><p class="eyebrow">You are here: <a href="/">Home</a> &gt; <a href="/writing/">Writing</a></p><h1>{esc(p["title"])}</h1><p class="post-meta">Posted on <time datetime="{p["date"]}">{p["date"]:%B} {p["date"].day}, {p["date"]:%Y}</time><span aria-hidden="true">*</span>{p["minutes"]} min read</p></header>
<div class="post-content">{p["html"]}</div><footer class="post-end"><span aria-hidden="true">*</span><p>Thanks for reading.</p><a href="/writing/">See all writing -></a></footer></article></div>
<aside class="article-aside" aria-label="More writing"><div class="panel"><div class="panel-top"><span>More Writing</span><span aria-hidden="true"></span></div><div class="panel-body"><p class="eyebrow">Read these next:</p>{related}</div></div>{ring}<div class="aside-note">* MADE ON THE INTERNET, WITH CARE.</div></aside></div>'''
        write(f'{p["slug"]}/index.html', page(p["title"], body, data, description=p["description"], path=f'/{p["slug"]}/', page_class="article-page", posts=posts))
    write("404.html", page("404 Not Found", not_found_html(), data, path="/404.html", page_class="error-page",
                           description="Page not found.", posts=posts, noindex=True))
    write("feed/index.html", page("RSS feed", feed_page_html(posts), data, path="/feed/", page_class="feed-page",
                                  description="Follow new writing by RSS.", posts=posts))
    write("feed.xml", feed(posts, data))
    print(f"built docs/: resume + {len(posts)} post(s)")


if __name__ == "__main__":
    build()
