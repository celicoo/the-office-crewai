"""Token overlap used to refuse duplicate articles and twin tasks."""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable, Optional, Tuple

_STOPWORDS = {
    "a", "o", "os", "as", "um", "uma", "de", "da", "do", "das", "dos", "e", "em",
    "no", "na", "nos", "nas", "para", "por", "com", "sem", "ao", "à", "às", "aos",
    "the", "an", "and", "or", "of", "to", "in", "on", "for", "with", "from",
    "que", "se", "não", "nao", "já", "ja", "sobre", "artigo", "materia", "matéria",
    "escreva", "escrever", "publique", "publicar", "pesquise", "pesquisa",
}


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFKD", (value or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def significant_tokens(value: str) -> set[str]:
    tokens = set()
    for tok in normalize_text(value).split():
        if tok in _STOPWORDS:
            continue
        if len(tok) >= 3 or (len(tok) == 2 and tok.isalpha()):
            tokens.add(tok)
        elif tok.isdigit() and len(tok) >= 4:
            tokens.add(tok)
    return tokens


def text_similarity(a: str, b: str) -> float:
    """Jaccard over significant tokens, boosted when one side contains the other."""
    ta = significant_tokens(a)
    tb = significant_tokens(b)
    na, nb = normalize_text(a), normalize_text(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.92
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    jaccard = inter / union if union else 0.0
    coverage = inter / min(len(ta), len(tb))
    if coverage >= 0.75:
        return max(jaccard, coverage * 0.95)
    return jaccard


def best_similar_match(
    query: str,
    candidates: Iterable[Tuple[str, str]],
    threshold: float = 0.72,
) -> Optional[Tuple[str, str, float]]:
    """Return (id, label_text, score) for the closest candidate above threshold."""
    best: Optional[Tuple[str, str, float]] = None
    for item_id, label in candidates:
        score = text_similarity(query, label)
        if score < threshold:
            continue
        if best is None or score > best[2]:
            best = (item_id, label, score)
    return best
