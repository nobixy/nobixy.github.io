"""Render public writing with Markdown formatting and safe HTML.

Both the site builder and the dashboard editor preview use this renderer so a post
looks the same before and after publication. Unknown HTML and active content are
removed; links and images keep only ordinary web or local destinations.
"""
from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

import markdown

_ALLOWED = {
    'p', 'br', 'hr', 'strong', 'em', 'b', 'i', 's', 'del', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
    'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
}
_VOID = {'br', 'hr', 'img'}
_BLOCKED = {'script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math', 'template'}


def _safe_url(value: str, *, image: bool = False) -> str | None:
    value = html.unescape(value).strip()
    if not value or any(ord(c) < 32 for c in value) or value.startswith('//'):
        return None
    url = urlsplit(value)
    if url.scheme:
        if url.scheme.lower() not in ({'http', 'https'} if image else {'http', 'https', 'mailto'}):
            return None
    elif value.startswith('\\') or url.netloc:
        return None
    return value


class _Cleaner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.blocked: list[str] = []
        self.open_tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _BLOCKED:
            self.blocked.append(tag)
            return
        if self.blocked or tag not in _ALLOWED:
            return
        values = dict(attrs)
        safe: list[str] = []
        if tag == 'a':
            href = _safe_url(values.get('href') or '')
            if href is not None:
                safe.append(f' href="{html.escape(href, quote=True)}"')
        elif tag == 'img':
            src = _safe_url(values.get('src') or '', image=True)
            if src is None:
                return
            safe.extend((f' src="{html.escape(src, quote=True)}"',
                         f' alt="{html.escape(values.get("alt") or "", quote=True)}"'))
        elif tag == 'code':
            code_class = values.get('class') or ''
            if re.fullmatch(r'language-[a-z0-9+_-]{1,32}', code_class):
                safe.append(f' class="{code_class}"')
        self.parts.append(f'<{tag}{"".join(safe)}>')
        if tag not in _VOID:
            self.open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and tag in _ALLOWED:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.blocked:
            if tag == self.blocked[-1]:
                self.blocked.pop()
            return
        if tag in self.open_tags:
            while self.open_tags:
                closing = self.open_tags.pop()
                self.parts.append(f'</{closing}>')
                if closing == tag:
                    break

    def handle_data(self, data: str) -> None:
        if not self.blocked:
            self.parts.append(html.escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        if not self.blocked:
            self.parts.append(f'&{name};')

    def handle_charref(self, name: str) -> None:
        if not self.blocked and re.fullmatch(r'(?:[0-9]+|[xX][0-9a-fA-F]+)', name):
            self.parts.append(f'&#{name};')

    def result(self) -> str:
        while self.open_tags:
            self.parts.append(f'</{self.open_tags.pop()}>')
        return ''.join(self.parts)


def render(text: str) -> str:
    cleaner = _Cleaner()
    cleaner.feed(markdown.markdown(text, extensions=['extra']))
    cleaner.close()
    return cleaner.result()
