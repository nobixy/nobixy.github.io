# nobixy.github.io

Joseph Noblett's living resume and writing. GitHub Pages serves `docs/` from `main`.

- `data/resume.json`: exported by the study dashboard. It holds the resume plus live learning progress and completed work.
- `site.json`: which contact details and links the public resume shows.
- `posts/YYYY-MM-DD-slug.md`: published writing.
- `drafts/`: git-ignored. The dashboard's "Export to my site" puts pieces here for a final edit.
- `build.py`: renders everything into `docs/`. The dashboard's "Publish to site" exports, builds, commits and pushes.

Local preview: `python3 build.py && python3 -m http.server -d docs 8000`
