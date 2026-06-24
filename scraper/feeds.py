"""RSS feed ingestion + full-page body extraction.

Normalizes the messy differences between BBC / NPR / Guardian feeds into one
Article dict shape:

    {
      "title": str,
      "summary": str,          # may be ""
      "url": str,              # canonical link
      "source": str,           # feed slug, e.g. "BBC"
      "published_at": str ISO, # parsed via dateutil, fallback to fetch time
    }

Bodies are extracted on the per-article call path so a single bad page can never
crash the whole run.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import feedparser
from dateutil import parser as dateparser

log = logging.getLogger("news_pulse.feeds")

FEEDS = [
    {"slug": "BBC", "url": "http://feeds.bbci.co.uk/news/rss.xml"},
    {"slug": "NPR", "url": "https://feeds.npr.org/1001/rss.xml"},
    {"slug": "Guardian", "url": "https://www.theguardian.com/world/rss"},
]


def _to_iso(raw: Optional[str]) -> str:
    """Best-effort ISO8601 string. Falls back to "now" when parsing fails."""
    if not raw:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        dt = dateparser.parse(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat(timespec="seconds")
    except (ValueError, TypeError, OverflowError) as e:
        log.debug("dateutil could not parse %r (%s) — using fetch time", raw, e)
        return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean(text: Optional[str]) -> str:
    if not text:
        return ""
    return " ".join(text.split()).strip()


def _entry_link(entry) -> str:
    # feedparser exposes the canonical URL under "link" everywhere we use.
    return entry.get("link") or entry.get("id") or ""


def _entry_summary(entry) -> str:
    # BBC/NPR put a blurb in "summary"; Guardian sometimes uses "description".
    # content:encoded is the full HTML body some feeds include — we prefer the
    # shorter summary for the article.summary field and let body extraction
    # fetch the real text from the page.
    return _clean(entry.get("summary") or entry.get("description") or "")


def parse_feeds() -> list[dict]:
    """Fetch every configured feed, return a flat list of normalized articles."""
    articles: list[dict] = []
    for feed in FEEDS:
        try:
            parsed = feedparser.parse(feed["url"])
        except Exception as e:  # network / parse blowups shouldn't kill the run
            log.error("feed %s failed to parse: %s", feed["slug"], e)
            continue

        if parsed.bozo and not parsed.entries:
            log.warning("feed %s returned no entries (bozo=%s)", feed["slug"], parsed.bozo)
            continue

        for entry in parsed.entries:
            url = _entry_link(entry)
            title = _clean(entry.get("title"))
            if not url or not title:
                continue
            articles.append(
                {
                    "title": title,
                    "summary": _entry_summary(entry),
                    "url": url,
                    "source": feed["slug"],
                    "published_at": _to_iso(entry.get("published") or entry.get("updated")),
                }
            )
    return articles


def extract_body(url: str) -> str:
    """Fetch the page and pull out the main article text.

    trafilatura is the first pass — it's tuned for news article extraction and
    handles boilerplate stripping well. If it returns nothing (paywall, JS-only
    page, 403, etc.) we fall back to a coarse BeautifulSoup <p> join so we still
    have *something* for clustering.
    """
    # Try trafilatura first.
    try:
        import trafilatura

        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(
                downloaded,
                include_comments=False,
                include_tables=False,
                favor_precision=True,
            )
            if text and len(text) > 120:
                return _clean(text)
    except Exception as e:  # pragma: no cover - depends on network/site
        log.debug("trafilatura failed for %s: %s", url, e)

    # Fallback: raw HTTP + BeautifulSoup paragraph scrape.
    try:
        import bs4
        import urllib.request

        req = urllib.request.Request(
            url,
            headers={"User-Agent": "NewsPulseBot/1.0 (+local build)"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310
            html = resp.read().decode("utf-8", errors="ignore")
        soup = bs4.BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "aside"]):
            tag.decompose()
        paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
        text = " ".join(p for p in paragraphs if p)
        if text:
            return _clean(text)
    except Exception as e:
        log.debug("beautifulsoup fallback failed for %s: %s", url, e)

    return ""
