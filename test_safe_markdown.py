import unittest
import json
from pathlib import Path
import build
from safe_markdown import render

class SafeMarkdownTests(unittest.TestCase):
    def test_keeps_normal_writing(self):
        html = render("# Heading\n\n**bold** [source](https://example.com)\n\n```python\nprint(1)\n```")
        self.assertIn("<h1>Heading</h1>", html)
        self.assertIn("<strong>bold</strong>", html)
        self.assertIn('href="https://example.com"', html)
        self.assertIn('class="language-python"', html)

    def test_strips_active_content(self):
        html = render('<script>alert(1)</script> [click](javascript:alert(1)) <img src="x" onerror="alert(1)">')
        self.assertNotIn("<script", html)
        self.assertNotIn("javascript:", html)
        self.assertNotIn("onerror", html)
        self.assertNotIn("alert(1)</script>", html)

    def test_resume_does_not_render_empty_bullet_list(self):
        data = json.loads((Path(__file__).parent / 'data' / 'resume.json').read_text())
        self.assertNotIn('<ul></ul>', build.resume_html(data, []))

    def test_decodes_entities_before_url_check(self):
        self.assertNotIn("href=", render('<a href="java&#x73;cript:alert(1)">bad</a>'))
        self.assertNotIn("src=", render('![bad](data:image/svg+xml;base64,xxx)'))

    def test_guestbook_signatures_are_plain_escaped_text(self):
        book = {"url": "https://github.com/x/y/discussions/1", "entries": [
            {"name": "<b>eve</b>", "profile": "javascript:alert(1)", "date": "2026-10-18",
             "text": "<script>alert(1)</script>\n**hi**"}]}
        html = build.guestbook_html(book)
        self.assertNotIn("<script", html)
        self.assertNotIn("<b>eve", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("**hi**", html)
        self.assertIn("<br>", html)
        self.assertIn("001", html)
        self.assertNotIn("javascript:", html)

if __name__ == "__main__": unittest.main()
