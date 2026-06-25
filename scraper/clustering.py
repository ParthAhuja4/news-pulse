from __future__ import annotations

"""IDF-weighted keyword-overlap clustering using DBSCAN (large corpus) or
union-find fallback (small corpus).

The algorithm is deliberately simple and explainable (a stated project goal in
PROJECT.md), not a sophisticated NLP pipeline:

1. Tokenize title + summary for each article: lowercase, strip HTML/URLs, strip
   a small English stopword + domain-name list, drop tokens shorter than 5 chars.
2. Compute smoothed IDF for every surviving token across the corpus.
3. Build a pairwise IDF-weighted similarity score for every article pair that
   shares at least one surviving token (inverted-index enumeration).
4. Convert similarity to distance (d = 1/(1+S)) and run DBSCAN. Two articles
   count as neighbours only when they share ≥ MIN_SHARED_TOKENS surviving tokens
   AND sit within DBSCAN_EPS distance; a core point needs ≥ DBSCAN_MIN_SAMPLES
   such neighbours. Because membership is density-based, a bridging article that
   only weakly links two topics is labelled noise and dropped instead of chaining
   the two topics together.
5. Each DBSCAN cluster (label ≥ 0) becomes one output cluster. Noise points
   (label -1) are singletons, already filtered by min_cluster_size. Label = 3
   most frequent tokens across all member articles, joined by " / ".

For small corpora (< MIN_CORPUS articles), steps 2–4 are skipped and we fall
back to a raw shared-token-count threshold + union-find (CLUSTER_THRESHOLD). IDF
weighting solves the degenerate-mega-cluster problem that plain overlap suffers
on news: generic words like "world"/"country"/"against" appear in ~10% of any
news feed and glue unrelated stories together; IDF down-weights them so only
story-specific co-occurrences carry the link. DBSCAN additionally rejects the
transitive chaining that union-find cannot avoid (A~B and B~C → A/B/C merge).

We rebuild from scratch every run (see ``db.replace_clusters``).
"""


import logging
import math
import os
import re
from collections import Counter, defaultdict
from typing import Iterable

log = logging.getLogger("news_pulse.clustering")

DEFAULT_THRESHOLD = 3
MIN_SHARED_TOKENS = 3
# DF-pruning and IDF linking thresholds (see cluster_articles docstring).
MIN_CORPUS = 30

# Hard ceiling: tokens appearing in more than MAX_DF_FRAC of articles are
# excluded from the IDF vocabulary. 0.08 means roughly the top ~8% of articles
# by document frequency are pruned, removing the generic news-vocabulary tail
# ("world", "country", "police", ...) that would otherwise chain unrelated
# stories together. Surviving tokens are the distinctive, story-specific words
# (ebola, counteroffensive, heatwave, maternity) that drive genuine topical
# links.
MAX_DF_FRAC = 0.08

# Minimum cumulative IDF weight to create an edge between two articles. In the
# DBSCAN path this only gates *whether an edge is considered at all* — the
# density check (DBSCAN_EPS + DBSCAN_MIN_SAMPLES) is what actually decides
# cluster membership. Kept for parity with the link-construction step.
LINK_WEIGHT = 3.5

# DBSCAN parameters (large-corpus path only).
#
# Distance metric: we convert each pair's cumulative IDF similarity score S
# into a distance d = 1 / (1 + S), so d ∈ (0, 1].  Two articles with no
# shared surviving tokens have S=0 → d=1.0 (maximum distance).  A pair that
# shares one token of IDF≈4.5 has S≈4.5 → d≈0.18.
#
# DBSCAN_EPS: neighbourhood radius. 0.05 corresponds to a high similarity
# (S ≥ 19), i.e. the two articles must share several rare tokens whose combined
# IDF weight is large. This is intentionally tight: it keeps clusters to
# genuinely-coherent stories and prevents the single-linkage-style chaining that
# inflated cluster counts under the old union-find path.
#
# DBSCAN_MIN_SAMPLES: an article must have at least this many neighbours
# within EPS to be a core point. 2 means a genuine pair is enough; raising
# it to 3 would require a mini-cluster of 3 mutually-close articles before
# any of them is considered a core point, producing fewer but denser clusters.
DBSCAN_EPS = 0.05
DBSCAN_MIN_SAMPLES = 2

# Compact, high-value English stopword list. Kept inline so the scraper has zero
# data-file dependencies; tuned for news headlines (e.g. "says", "us"=U.S.).
STOPWORDS = {
    "live",
    "news",
    "update",
    "updates",
    "breaking",
    "latest",
    "today",
    "week",
    "month",
    "june",
    "email",
    "received",
    "minutes",
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "if",
    "on",
    "in",
    "at",
    "to",
    "of",
    "for",
    "with",
    "from",
    "by",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "they",
    "them",
    "their",
    "we",
    "us",
    "our",
    "you",
    "your",
    "he",
    "she",
    "his",
    "her",
    "not",
    "no",
    "so",
    "than",
    "then",
    "will",
    "would",
    "can",
    "could",
    "should",
    "may",
    "might",
    "must",
    "about",
    "after",
    "before",
    "over",
    "under",
    "more",
    "most",
    "such",
    "also",
    "into",
    "out",
    "up",
    "down",
    "new",
    "one",
    "two",
    "says",
    "said",
    "say",
    "told",
    "tell",
    "what",
    "which",
    "who",
    "whom",
    "how",
    "when",
    "where",
    "why",
    "via",
    "amid",
    "amidst",
    "while",
    "during",
    "between",
    "among",
    "because",
    "since",
    "still",
    "yet",
    "very",
    "just",
    "only",
    "even",
    "like",
    "off",
    "per",
    # Boilerplate verbs/phrases that recur across feed summaries regardless of
    # the actual story ("Continue reading...", "Sign up for our newsletter").
    "continue",
    "reading",
    "read",
    "sign",
    "newsletter",
    "subscribe",
    "photo",
    "video",
    "watch",
    "listen",
    "duration",
    "copyright",
}

# Tokens that are common across an entire source's feed rather than specific to
# a single story — if left in they collapse every article from that source into
# one mega-cluster. Domain names + URL fragments are the worst offenders.
DOMAIN_TOKENS = {
    "bbc",
    "bbccouk",
    "bbccouknews",
    "wwwbbc",
    "cbbc",
    "npr",
    "nprorg",
    "wwwnpr",
    "wamu",
    "theguardian",
    "guardian",
    "wwwtheguardian",
    "theguardiancom",
    "https",
    "http",
    "www",
    "com",
    "co",
    "uk",
    "html",
    "php",
    "rss",
    "medium",
    "com",
    "org",
    "net",
    "url",
    "link",
    "story",
    "stories",
}

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_TAG_RE = re.compile(r"<[^>]+>")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def get_threshold() -> int:
    raw = os.environ.get("CLUSTER_THRESHOLD", str(DEFAULT_THRESHOLD))
    try:
        v = int(raw)
        if v < 1:
            return DEFAULT_THRESHOLD
        return v
    except ValueError:
        return DEFAULT_THRESHOLD


def tokenize(text: str) -> set[str]:
    """Lowercase, strip HTML/URLs, split, drop stopwords/domain tokens.

    Order matters: kill URLs *before* tokenizing so the scheme/host don't
    survive as tokens, and strip HTML tags first so Guardian's ``<p>`` summaries
    don't leak tag names into the vocabulary.
    """
    if not text:
        return set()
    text = _TAG_RE.sub(" ", text)  # remove <tags> but keep their text
    text = _URL_RE.sub(" ", text)  # remove http(s)://… wholesale
    tokens = _TOKEN_RE.findall(text.lower())
    return {
        t
        for t in tokens
        if len(t) >= 5
        and t not in STOPWORDS
        and t not in DOMAIN_TOKENS
        and not t.isdigit()
    }


class UnionFind:
    """Minimal union-find with path compression + union by rank."""

    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def _label_for(members: list[dict]) -> str:
    """Top-3 most frequent significant tokens across member articles."""
    counter: Counter = Counter()
    for toks in (m["tokens"] for m in members):
        counter.update(toks)
    top = [w for w, _ in counter.most_common(3)]
    return " / ".join(top) if top else "untitled"


def _dbscan(
    n: int,
    pair_weight: dict[tuple[int, int], float],
    pair_shared: dict[tuple[int, int], int],
    link_weight: float,
    eps: float,
    min_samples: int,
) -> list[int]:
    """Pure-Python DBSCAN over a sparse IDF-similarity graph.

    Distance between articles i and j:
        d(i, j) = 1 / (1 + S)   where S = pair_weight[(i,j)] (or 0 if absent)

    This maps S=0 (no shared tokens) → d=1.0 and S→∞ → d→0.  Articles are
    neighbours if d ≤ eps AND pair_shared ≥ MIN_SHARED_TOKENS, so a single
    coincidental shared rare word cannot create a link on its own.

    Returns a label list of length n.  Noise points get label -1; cluster
    labels are non-negative integers.
    """
    # Build sparse neighbour lists: only store pairs within eps to keep memory
    # O(edges) rather than O(n²).
    neighbours: list[list[int]] = [[] for _ in range(n)]
    for (i, j), w in pair_weight.items():
        if pair_shared[(i, j)] < MIN_SHARED_TOKENS:
            continue
        d = 1.0 / (1.0 + w)
        if d <= eps:
            neighbours[i].append(j)
            neighbours[j].append(i)

    UNVISITED = -2
    NOISE = -1
    labels = [UNVISITED] * n
    cluster_id = 0

    for idx in range(n):
        if labels[idx] != UNVISITED:
            continue
        nbrs = neighbours[idx]
        if len(nbrs) + 1 < min_samples:  # +1 counts the point itself
            labels[idx] = NOISE
            continue
        # idx is a core point — start a new cluster via BFS expansion.
        labels[idx] = cluster_id
        queue = list(nbrs)
        for nb in queue:
            if labels[nb] == NOISE:
                labels[nb] = cluster_id  # border point absorbed into cluster
            if labels[nb] != UNVISITED:
                continue
            labels[nb] = cluster_id
            if len(neighbours[nb]) + 1 >= min_samples:
                queue.extend(neighbours[nb])  # nb is also a core point
        cluster_id += 1

    return labels


def cluster_articles(
    items: list[dict], link_weight: float = LINK_WEIGHT, min_cluster_size: int = 2
) -> list[dict]:
    """
    Cluster articles via IDF-weighted keyword overlap + DBSCAN.

    Large corpus (≥ MIN_CORPUS articles):
      1. Compute smoothed IDF; prune tokens appearing in > MAX_DF_FRAC of docs.
      2. Build a sparse pairwise IDF-similarity table (inverted-index approach).
      3. Convert similarity to distance d = 1/(1+S) and run DBSCAN with
         DBSCAN_EPS / DBSCAN_MIN_SAMPLES.  Articles that weakly bridge two
         unrelated topics become noise and are excluded, breaking the
         single-linkage chaining that inflated cluster counts under union-find.
      4. Each DBSCAN label ≥ 0 is one output cluster; noise (label -1) becomes
         singletons filtered out by min_cluster_size.

    Small corpus (< MIN_CORPUS): IDF is unreliable on tiny corpora, so we fall
    back to a raw shared-token-count threshold (CLUSTER_THRESHOLD) plus
    union-find to derive connected components.

    The return shape is identical to the original implementation:
        [{"cluster_id", "label", "size", "article_ids", "articles"}, ...]
    sorted by descending size.
    """
    n = len(items)
    if n == 0:
        return []

    # --- 1. Tokenization ---
    for it in items:
        if "tokens" not in it:
            text = (
                f"{it.get('title', '')} {it.get('summary', it.get('description', ''))}"
            )
            it["tokens"] = tokenize(text)

    use_idf = n >= MIN_CORPUS
    idf: dict[str, float] = {}

    if use_idf:
        # --- 2. Document frequency + IDF, with the hard max-df ceiling ---
        doc_freq: dict[str, int] = defaultdict(int)
        for it in items:
            for tok in it["tokens"]:
                doc_freq[tok] += 1

        max_df = max(2, math.ceil(n * MAX_DF_FRAC))
        for tok, df in doc_freq.items():
            if df <= max_df:
                idf[tok] = math.log((n + 1) / df)  # smoothed IDF
        use_idf = len(idf) > 0  # corpus might not yield any surviving tokens

    if use_idf:
        # --- 3. Build pairwise similarity via inverted index ---
        postings: dict[str, list[int]] = defaultdict(list)
        for idx, it in enumerate(items):
            for tok in it["tokens"]:
                if tok in idf:
                    postings[tok].append(idx)

        pair_weight: dict[tuple[int, int], float] = defaultdict(float)
        pair_shared: dict[tuple[int, int], int] = defaultdict(int)
        for tok, idxs in postings.items():
            w = idf[tok]
            m = len(idxs)
            for a in range(m):
                ia = idxs[a]
                for b in range(a + 1, m):
                    key = (ia, idxs[b])
                    pair_weight[key] += w
                    pair_shared[key] += 1

        # --- 4. DBSCAN clustering ---
        # DBSCAN replaces union-find here.  Union-find uses single-linkage
        # (A→B + B→C → A/B/C all merge), which chains loosely-related articles
        # across an entire news cycle into one giant component.  DBSCAN requires
        # a point to have ≥ DBSCAN_MIN_SAMPLES neighbours within DBSCAN_EPS;
        # bridging articles that don't satisfy this density criterion are labelled
        # noise and dropped, yielding tighter, more coherent clusters.
        labels = _dbscan(
            n,
            pair_weight,
            pair_shared,
            link_weight,
            eps=DBSCAN_EPS,
            min_samples=DBSCAN_MIN_SAMPLES,
        )
        log.debug(
            "DBSCAN produced %d clusters (noise=%d)",
            max(labels) + 1 if labels else 0,
            labels.count(-1),
        )

        # --- 5. Collect DBSCAN groups ---
        groups: dict[int, list[int]] = defaultdict(list)
        for idx, lbl in enumerate(labels):
            if lbl >= 0:
                groups[lbl].append(idx)

    else:
        # Fallback for tiny corpora: raw shared-token-count threshold + union-find.
        uf = UnionFind(n)
        raw_threshold = get_threshold()
        for i in range(n):
            for j in range(i + 1, n):
                shared = len(items[i]["tokens"] & items[j]["tokens"])
                if shared >= raw_threshold:
                    uf.union(i, j)

        groups = defaultdict(list)
        for idx in range(n):
            groups[uf.find(idx)].append(idx)

    # --- 6. Format output (shape unchanged) ---
    result = []
    for root, idxs in groups.items():
        if len(idxs) < min_cluster_size:
            continue

        members = [items[i] for i in idxs]
        members.sort(
            key=lambda x: x.get("published_at", x.get("pub_date", "")), reverse=True
        )

        result.append(
            {
                "cluster_id": root,
                "label": _label_for(members),
                "size": len(members),
                "article_ids": [m["id"] for m in members],
                "articles": members,
            }
        )

    result.sort(key=lambda x: x["size"], reverse=True)
    return result
