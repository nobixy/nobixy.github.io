# nobixy.github.io

Joseph Noblett's living resume and writing. GitHub Pages serves `docs/` from `main`.

Everything here is edited by hand now. The old Obsidian study dashboard and its nightly export are retired.

- `data/profile.json`: the resume (headline, summary, experience, skills, education).
- `site.json`: what I'm learning right now, the "Off the Clock" list, "What's New?!" items, the Writing page intro and the kind of each piece (Story, Study notes, Essay, Personal).
- `posts/YYYY-MM-DD-slug.md`: published writing.
- `drafts/`: git-ignored, never built.
- `build.py`: renders everything into `docs/`.
- `write.py`: `new "Title" [Kind]`, `list`, `publish slug` (build, commit, then asks before pushing).

Local preview: `python3 build.py && python3 -m http.server -d docs 8000`

Privacy: no phone, ZIP or email, and no habit, money or activity data. The site shows what I'm learning, not how much I did.
