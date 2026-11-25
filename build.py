#!/usr/bin/env python3
"""Build the site into docs/ (GitHub Pages serves main:/docs).

Sources:
  data/profile.json  the resume (edit by hand)
  site.json          what I'm doing now, news items, writing intro and the kind of each piece
  posts/*.md         published writing: YYYY-MM-DD-slug.md with title/date/description front matter
  drafts/            git-ignored; never built (python3 write.py new/publish)

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
ADMIN_VERSION = hashlib.sha256((ROOT / "admin.js").read_bytes()).hexdigest()[:12]
# The Writer's Station (/admin/) is a static shell: nothing secret lives in it. Saving and publishing need a
# GitHub token only Joseph holds, and GitHub checks it on every request. This policy keeps the page to
# its own scripts and the GitHub API, so nothing else on the page can ever see that token.
ADMIN_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
             "connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'")
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


def excerpt(body: str, words: int = 42) -> str:
    """The opening of a piece as plain text: first real paragraph, markdown stripped."""
    for para in re.split(r"\n\s*\n", body.strip()):
        para = para.strip()
        if not para or para.startswith(("#", "```", "|", ">", "---", "![")):
            continue
        text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", para)
        text = re.sub(r"[*_`]+", "", text)
        text = " ".join(text.split())
        cut = text.split()
        return text if len(cut) <= words else " ".join(cut[:words]).rstrip(",;:.") + "..."
    return ""


def load_posts(kinds: dict | None = None) -> list[dict]:
    kinds = kinds or {}
    posts = []
    for p in sorted((ROOT / "posts").glob("*.md")):
        m = re.match(r"^(\d{4}-\d{2}-\d{2})-(.+)\.md$", p.name)
        if not m:
            continue
        meta, body = front_matter(p.read_text(encoding="utf-8"))
        words = len(body.split())
        posts.append({"slug": m.group(2), "date": dt.date.fromisoformat(meta.get("date") or m.group(1)),
                      "title": meta.get("title") or m.group(2), "description": meta.get("description", ""),
                      "html": render(body), "words": words, "excerpt": excerpt(body), "plain": " ".join(re.sub(r"[#*_`>\[\]()]", " ", body).split()),
                      "kind": kinds.get(m.group(2), "Writing"),
                      "minutes": max(1, round(words / WPM))})
    posts.sort(key=lambda x: x["date"])
    for n, p in enumerate(posts, 1):
        p["no"] = n  # piece number in the order written: No. 01 is the first thing I published
    posts.reverse()
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
         posts: list | None = None, noindex: bool = False, head_extra: str = "") -> str:
    name = data["profile"]["name"]
    full = title if title == name else f"{title} | {name}"
    desc = description or data["profile"].get("headline", "")
    home = "" if path == "/" else "/"
    posts = posts or []
    menu_items = (
        ("/", "~", "Home"),
        (f"{home}#hello", "*", "About me"),
        (f"{home}#learning", "+", "Now learning"),
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
    now = data.get("now", {})
    subjects = esc(now.get("short", "")).replace(" + ", " <span>+</span> ")
    focus = now.get("focus", [])
    news = ["Welcome to my homepage! Thanks for stopping by.",
            f"Now learning: {', '.join(f['name'] + ' (' + f['where'] + ')' for f in focus[:2]) or 'the basics'}."]
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
{head_extra}
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
  <section class="side-box status-box"><h2>* What I'm Up To</h2><p>{esc(now.get("status", "Learning, one rep at a time."))}</p><p class="tiny-label">CURRENTLY LEARNING</p><p class="open-subjects">{subjects or "More soon"}</p><p class="tiny-label">WORDS PUBLISHED</p>{odometer(sum(p["words"] for p in posts))}<a href="{home}#learning">See what I'm learning -></a><a href="/writing/">Read the writing -></a></section>
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


def post_item(p: dict, newest, *, full: bool = False) -> str:
    blurb = p["description"] or (p["excerpt"] if full else "")
    side = (f'<span class="post-side"><span class="kind-tag">{esc(p["kind"])}</span>'
            f'<time datetime="{p["date"]}">{p["date"]:%b} {p["date"].day}, {p["date"]:%Y}</time>'
            + (f'<span class="post-stats">{p["words"]:,} words / {p["minutes"]} min</span>' if full else "")
            + '</span>')
    return (f'<li data-kind="{esc(p["kind"], quote=True)}" data-date="{p["date"]}" data-words="{p["words"]}" data-text="{esc((p["title"] + " " + p["description"] + " " + p["plain"]).lower(), quote=True)}"><a class="post-link" href="/{p["slug"]}/"><span class="post-number" title="Piece No. {p["no"]:02d}">{p["no"]:02d}</span>'
            f'<span class="post-copy"><strong>{"<em class=\"new-tag blink\">NEW!</em>" if p["date"] == newest else ""}{esc(p["title"])}</strong>'
            + (f'<span>{esc(blurb)}</span>' if blurb else "") + f'</span>{side}</a></li>')


def post_list(posts: list[dict], limit: int | None = None, *, newest=None) -> str:
    items = posts[:limit] if limit else posts
    if not items:
        return '<p class="muted">First posts are on the way.</p>'
    newest = newest or max(p["date"] for p in items)
    return '<ul class="posts">' + "".join(post_item(p, newest) for p in items) + "</ul>"


STOPWORDS = set("""a an the and or but if so of to in on at by for with from as is are was were be been being am i me my we our
you your he she it its they them their this that these those there here what which who whom when where why how not no do does did
done have has had will would can could should may might must just very really than then too also into out up down over about after
before again more most some any all each few other such only own same both get got one like even it's i'm don't can't didn't i've
i'll that's there's you're they're him her his us much many way well back now still because while through off going thing things
make made say said know see went go come came want take let them i'd he's she's we're""".split())


def numbers_panel(posts: list[dict]) -> str:
    """Real numbers about the writing, computed at build time: a publishing calendar, words per piece, favorite words."""
    if not posts:
        return ""
    end = dt.date.today()
    start = end - dt.timedelta(days=end.weekday() + 1 + 7 * 25)  # 26 weeks, Sunday-first columns
    per_day = {}
    for p in posts:
        per_day.setdefault(p["date"], []).append(p)
    weeks, months = [], []
    d = start
    for w in range(26):
        col = []
        for _ in range(7):
            items = per_day.get(d, [])
            level = 0 if d > end else min(len(items), 2) + (0 if items else 0)
            tip = f"{d:%b} {d.day}: " + (", ".join(x["title"] for x in items) if items else "nothing published")
            col.append(f'<i class="cal-{"future" if d > end else level}" title="{esc(tip, quote=True)}"></i>')
            if d.day <= 7 and d.weekday() == 6:
                months.append((w, f"{d:%b}"))
            d += dt.timedelta(days=1)
        weeks.append("<span>" + "".join(col) + "</span>")
    month_labels = "".join(f'<b style="grid-column:{w + 1}">{m}</b>' for w, m in months)
    in_window = sum(1 for p in posts if start <= p["date"] <= end)
    longest = max(p["words"] for p in posts)
    bars = "".join(
        f'<li title="{esc(p["title"], quote=True)}: {p["words"]:,} words, {p["minutes"]} min"><a href="/{p["slug"]}/"><span class="nb-no">{p["no"]:02d}</span>'
        f'<span class="nb-title">{esc(p["title"])}</span><span class="nb-track"><span style="width:{p["words"] * 100 / longest:.1f}%"></span></span>'
        f'<span class="nb-num">{p["words"]:,}</span></a></li>' for p in sorted(posts, key=lambda x: x["no"]))
    counts = {}
    for p in posts:
        for w in re.findall(r"[a-z][a-z'-]+", p["plain"].lower()):
            if len(w) > 3 and w not in STOPWORDS:
                counts[w] = counts.get(w, 0) + 1
    fav = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:12]
    fmax = fav[0][1] if fav else 1
    tags = "".join(f'<li style="font-size:{12 + 10 * c / fmax:.0f}px" title="used {c} times">{esc(w)} <small>{c}</small></li>' for w, c in fav)
    total_min = sum(p["minutes"] for p in posts)
    return f'''<section class="panel numbers-panel"><div class="panel-top"><span>By the Numbers</span><span>real counts, updated every post</span></div><div class="panel-body">
<h3 class="subheading">PUBLISHING CALENDAR: LAST 26 WEEKS</h3>
<div class="cal" role="img" aria-label="{in_window} pieces published in the last 26 weeks"><div class="cal-months">{month_labels}</div><div class="cal-grid">{"".join(weeks)}</div></div>
<p class="cal-legend"><span><i class="cal-0"></i>nothing</span><span><i class="cal-1"></i>1 piece</span><span><i class="cal-2"></i>2+</span> &nbsp; {in_window} piece{"s" if in_window != 1 else ""} in 26 weeks</p>
<h3 class="subheading">WORDS PER PIECE</h3><ul class="nb-bars">{bars}</ul>
<div class="nb-row"><div><h3 class="subheading">WORDS I REACH FOR</h3><ul class="nb-tags">{tags}</ul></div>
<div class="nb-facts"><h3 class="subheading">ALL OF IT</h3><p><b>{sum(p["words"] for p in posts):,}</b> words</p><p><b>{total_min}</b> min to read everything</p><p><b>{round(sum(p["words"] for p in posts) / len(posts)):,}</b> words per piece on average</p></div></div>
</div></section>'''


def writing_hub(posts: list[dict], settings: dict) -> str:
    """The writing room: what's newest, real totals, filters by kind, and the archive by month."""
    intro = "".join(f"<p>{esc(x)}</p>" for x in settings.get("writing_intro", []))
    head = ('<section class="page-heading"><p class="eyebrow">You are here: Home &gt; Writing</p>'
            '<h1>Things I put <em>into words.</em><span aria-hidden="true">*</span></h1>'
            '<p>Study notes, short stories, essays and thoughts in progress. This is where they land.</p></section>')
    if not posts:
        return head + '<section class="panel archive-panel"><div class="panel-body"><p>First posts are on the way.</p></div></section>'
    latest, newest = posts[0], posts[0]["date"]
    words = sum(p["words"] for p in posts)
    first = min(p["date"] for p in posts)
    kinds = sorted({p["kind"] for p in posts})
    feature = f'''<section class="panel feature-panel"><div class="section-bar"><span>Fresh Off the Press!</span><span class="blink">NEW!</span></div>
<div class="feature-body"><p class="feature-label">PIECE No. {latest["no"]:02d} &nbsp;/&nbsp; {esc(latest["kind"].upper())} &nbsp;/&nbsp; {us_date(latest["date"].isoformat())}</p>
<h2><a href="/{latest["slug"]}/">{esc(latest["title"])}</a></h2>
<blockquote class="feature-excerpt"><p>{esc(latest["excerpt"])}</p></blockquote>
<p class="feature-foot"><span>{latest["words"]:,} words / {latest["minutes"]} min read</span><a class="dlg-btn" href="/{latest["slug"]}/">Read it -></a></p></div></section>'''
    stats = (f'<div class="stat-row stat-row-3"><div><strong>{len(posts)}</strong><span>PIECES PUBLISHED</span></div>'
             f'<div><strong>{words:,}</strong><span>WORDS SO FAR</span></div>'
             f'<div><strong>{us_date(first.isoformat())}</strong><span>WRITING SINCE</span></div></div>')
    tabs = ('<div class="kind-tabs" role="toolbar" aria-label="Show writing by kind" hidden>'
            '<button type="button" class="kind-tab" aria-pressed="true" data-kind="">All <small>' + str(len(posts)) + '</small></button>'
            + "".join(f'<button type="button" class="kind-tab" aria-pressed="false" data-kind="{esc(k, quote=True)}">{esc(k)} '
                      f'<small>{sum(p["kind"] == k for p in posts)}</small></button>' for k in kinds)
            + '<button type="button" class="kind-tab lucky" data-lucky>I\'m Feeling Lucky!</button></div>'
            + '<div class="archive-tools" hidden><label>Search: <input type="search" id="archive-search" placeholder="title or words..."></label>'
            '<label>Sort: <select id="archive-sort"><option value="new">Newest first</option><option value="old">Oldest first</option>'
            '<option value="long">Longest first</option><option value="short">Shortest first</option></select></label></div>')
    months, groups = [], {}
    for p in posts:
        key = (p["date"].year, p["date"].month)
        if key not in groups:
            groups[key] = []
            months.append(key)
        groups[key].append(p)
    archive = "".join(
        f'<section class="month" aria-label="{dt.date(y, m, 1):%B %Y}"><h3 class="month-head"><span>{dt.date(y, m, 1):%B %Y}</span>'
        f'<small>{len(groups[(y, m)])} piece{"s" if len(groups[(y, m)]) != 1 else ""}</small></h3>'
        '<ul class="posts">' + "".join(post_item(p, newest, full=True) for p in groups[(y, m)]) + '</ul></section>'
        for y, m in months)
    return (head + feature
            + f'<section class="panel archive-panel"><div class="panel-top"><span>All My Writing</span><span>{len(posts)} pieces</span></div>'
            f'<div class="panel-body"><div class="archive-intro">{intro}</div>{stats}{tabs}'
            f'<p class="filter-empty" hidden>Nothing of that kind yet.</p><div class="archive">{archive}</div>'
            '<p class="archive-foot">Want new pieces as they land? <a href="/feed/">Get the RSS feed -></a></p></div></section>'
            + numbers_panel(posts))


def resume_html(data: dict, posts: list[dict]) -> str:
    profile, now = data["profile"], data.get("now") or {}
    links = "".join(
        f'<a href="{esc(link["href"], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(link["label"])} -></a>'
        for link in profile.get("links", [])
    )
    first = profile["name"].split()[0]
    events = [(str(n["date"]), f'<span>{esc(n["text"])}</span>') for n in data.get("news", [])]
    events += [(p["date"].isoformat(), f'<a href="/{p["slug"]}/">New writing: {esc(p["title"])}</a>') for p in posts]
    events.sort(key=lambda e: e[0], reverse=True)
    updates = [f'<li><time datetime="{d}">{us_date(d)}</time>{html_}</li>' for d, html_ in events[:5]]
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

    if now.get("focus"):
        focus = "".join(
            f'<li><span class="focus-tag">{esc(f["tag"])}</span><span class="focus-name">{esc(f["name"])}</span>'
            + (f'<a class="focus-where" href="{esc(f["href"], quote=True)}" target="_blank" rel="noopener noreferrer">{esc(f["where"])} -></a>'
               if f.get("href") else f'<span class="focus-where">{esc(f["where"])}</span>') + '</li>'
            for f in now["focus"])
        out.append(f"""<section class="panel learning-panel" id="learning"><div class="section-bar"><span>What I'm Learning</span></div><div class="panel-body">
<p>{esc(now.get("intro", ""))}</p>
<h3 class="subheading">ON MY DESK RIGHT NOW</h3><ul class="focus">{focus}</ul>
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
        total = sum(p["words"] for p in posts)
        out.append(f'<section class="panel writing-panel"><div class="section-bar"><span>My Writing</span><span class="blink">NEW!</span></div><div class="panel-body">{post_list(posts, 3)}<a class="text-link" href="/writing/">-> ALL {len(posts)} PIECES ({total:,} WORDS)</a></div></section>')

    if now.get("off_clock"):
        hobbies = "".join(f'<div><dt>{esc(h["name"])}</dt><dd>{esc(h["text"])}</dd></div>' for h in now["off_clock"])
        out.append(f'<section class="panel offclock-panel"><div class="section-bar"><span>Off the Clock</span></div><div class="panel-body"><dl class="skills">{hobbies}</dl></div></section>')

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
    return f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>{name}: writing</title><link>{SITE_URL}/writing/</link><description>{name} writes about learning, code and whatever is on his mind.</description>{items}</channel></rss>\n'


def write(rel: str, text: str) -> None:
    text = ascii_punct(text)
    f = OUT / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text, encoding="utf-8")


def build() -> None:
    data = json.loads((ROOT / "data" / "profile.json").read_text(encoding="utf-8"))
    settings = json.loads((ROOT / "site.json").read_text(encoding="utf-8"))
    data["now"], data["news"] = settings.get("now", {}), settings.get("news", [])
    posts = load_posts(settings.get("writing_kinds"))
    latest = max([data.get("updated", "")] + [n["date"] for n in data["news"]] + [p["date"].isoformat() for p in posts])
    data["updated"] = latest
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    write(".nojekyll", "")
    shutil.copy(ROOT / "style.css", OUT / "style.css")
    shutil.copy(ROOT / "site.js", OUT / "site.js")
    shutil.copy(ROOT / "admin.js", OUT / "admin.js")
    shutil.copy(ROOT / "avatar.jpg", OUT / "avatar.jpg")
    write("index.html", page(data["profile"]["name"], resume_html(data, posts), data, page_class="home-page", posts=posts))
    write("writing/index.html", page("Writing", writing_hub(posts, settings), data, path="/writing/", page_class="archive-page",
                                     description="Study notes, short stories, essays and thoughts in progress.", posts=posts))
    for n, p in enumerate(posts):
        others = [other for other in posts if other["slug"] != p["slug"]][:2]
        newer, older = posts[n - 1] if n else posts[-1], posts[(n + 1) % len(posts)]
        ring = (f'<nav class="webring" aria-label="Writing ring"><p class="ring-name">* NOBIXY\'S WRITING RING *</p>'
                f'<p><a href="/{older["slug"]}/" rel="prev"><< older</a> | <a href="/writing/">index</a> | '
                f'<a href="/{newer["slug"]}/" rel="next">newer >></a></p></nav>') if len(posts) > 1 else ""
        prev_p = posts[n + 1] if n + 1 < len(posts) else None
        next_p = posts[n - 1] if n else None
        pager = ('<nav class="pager" aria-label="Older and newer writing">'
                 + (f'<a class="pager-old" href="/{prev_p["slug"]}/" rel="prev"><small><< OLDER</small>{esc(prev_p["title"])}</a>' if prev_p else '<span></span>')
                 + (f'<a class="pager-new" href="/{next_p["slug"]}/" rel="next"><small>NEWER >></small>{esc(next_p["title"])}</a>' if next_p else '<span></span>')
                 + '</nav>') if len(posts) > 1 else ""
        related = post_list(others, newest=posts[0]["date"]) if others else '<p>More writing is on the way.</p>'
        body = f'''<div class="article-grid"><div><a class="back-link" href="/writing/"><- BACK TO THE ARCHIVE</a>
<article class="post-panel"><header class="post-header"><p class="eyebrow">You are here: <a href="/">Home</a> &gt; <a href="/writing/">Writing</a></p><h1>{esc(p["title"])}</h1><p class="post-meta"><span class="kind-tag">{esc(p["kind"])}</span>Piece No. {p["no"]:02d}<span aria-hidden="true">*</span>Posted on <time datetime="{p["date"]}">{p["date"]:%B} {p["date"].day}, {p["date"]:%Y}</time><span aria-hidden="true">*</span>{p["words"]:,} words<span aria-hidden="true">*</span>{p["minutes"]} min read</p></header>
<div class="post-content">{p["html"]}</div><footer class="post-end"><span aria-hidden="true">*</span><p>Thanks for reading.</p><a href="/writing/">See all writing -></a></footer></article>{pager}</div>
<aside class="article-aside" aria-label="More writing"><div class="panel"><div class="panel-top"><span>More Writing</span><span aria-hidden="true"></span></div><div class="panel-body"><p class="eyebrow">Read these next:</p>{related}</div></div>{ring}<div class="aside-note">* MADE ON THE INTERNET, WITH CARE.</div></aside></div>'''
        write(f'{p["slug"]}/index.html', page(p["title"], body, data, description=p["description"], path=f'/{p["slug"]}/', page_class="article-page", posts=posts))
    head = (f'<meta http-equiv="Content-Security-Policy" content="{ADMIN_CSP}">\n'
            f'<meta name="referrer" content="no-referrer">\n<script src="/admin.js?v={ADMIN_VERSION}" defer></script>')
    write("admin/index.html", page("Writer's Station", (ROOT / "admin_body.html").read_text(encoding="utf-8"), data,
                                   path="/admin/", page_class="admin-page", description="Private writing desk.",
                                   posts=posts, noindex=True, head_extra=head))
    write("404.html", page("404 Not Found", not_found_html(), data, path="/404.html", page_class="error-page",
                           description="Page not found.", posts=posts, noindex=True))
    write("feed/index.html", page("RSS feed", feed_page_html(posts), data, path="/feed/", page_class="feed-page",
                                  description="Follow new writing by RSS.", posts=posts))
    write("feed.xml", feed(posts, data))
    print(f"built docs/: resume + {len(posts)} post(s)")


if __name__ == "__main__":
    build()
