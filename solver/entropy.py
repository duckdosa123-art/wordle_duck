"""Shannon-entropy guess ranking, vectorised with numpy.

For each candidate guess we score it against every remaining candidate secret:
entropy = -sum p(pattern) * log2 p(pattern). High-entropy guesses split the
candidate pool into equally-sized buckets, which is what minimises expected
guesses. Duplicate-letter feedback (green-first, left-to-right yellow
consumption) is computed exactly, matching solver/match.py.
"""
import hashlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CACHE_DIR = HERE / ".entropy_cache"

# heavy = cache candidate-set rankings to disk
HEAVY_PAIRS = 2_000_000


def _to_codes(words):
    """List of 5-letter words -> (N,5) uint8 letter codes."""
    arr = np.frombuffer("".join(words).encode("ascii"), dtype=np.uint8)
    return (arr - 97).reshape(len(words), 5)


def _pattern_indices(G, S):
    """Base-3 feedback index (0..242) for every guess in G against every secret in S."""
    B, M = G.shape[0], S.shape[0]
    eq = G[:, None, :] == S[None, :, :]                      # (B,M,5) green mask
    pat = eq.astype(np.uint8) * 2

    # prior[i][b,m]: same guess letter, earlier position, not green there
    prior = np.zeros((5, B, M), np.int16)
    for i in range(5):
        for j in range(i):
            prior[i] += ((G[:, j] == G[:, i])[:, None] & ~eq[:, :, j])

    for i in range(5):
        ci = G[:, i][:, None]                                # (B,1)
        tot = np.zeros((B, M), np.int16)
        for j in range(5):
            tot += (S[None, :, j] == ci) & ~eq[:, :, j]      # secret copies of this letter, off-green
        yellow = (~eq[:, :, i]) & ((tot - prior[i]) > 0)
        pat[:, :, i] = np.where(yellow, 1, pat[:, :, i])

    p = pat.astype(np.int32)
    return p[..., 0] * 81 + p[..., 1] * 27 + p[..., 2] * 9 + p[..., 3] * 3 + p[..., 4]


def _entropies(G, S):
    """Shannon entropy (bits) of every guess row in G over secrets S."""
    B, M = G.shape[0], S.shape[0]
    out = np.empty(B, dtype=np.float64)
    for start in range(0, B, 1024):
        chunk = G[start:start + 1024]
        n = chunk.shape[0]
        idx = _pattern_indices(chunk, S)
        flat = idx + np.arange(n, dtype=np.int64)[:, None] * 243
        counts = np.bincount(flat.ravel(), minlength=n * 243).reshape(n, 243).astype(np.float64)
        p = counts / M
        info = np.zeros_like(p)
        np.log2(p, out=info, where=p > 0)
        out[start:start + n] = -(p * info).sum(axis=1)
    return out


def _cache_key(cand, pool):
    h = hashlib.md5()
    h.update(("\n".join(cand) + "#" + "\n".join(pool)).encode())
    return h.hexdigest()


def rank(candidates, guesses, answer_set, top=5, cache=True):
    """Best guesses for the current candidate pool.

    Returns a list of dicts (word, bits, is_answer), best first.
    Heavy computations (large pools) are cached under solver/.entropy_cache/.
    """
    cand = sorted({w.lower() for w in candidates if len(w) == 5})
    pool = [w.lower() for w in guesses if len(w) == 5]
    if not cand or not pool:
        return []

    heavy = len(cand) * len(pool) > HEAVY_PAIRS
    bits = None
    key = _cache_key(cand, pool) if heavy else None
    if heavy and cache:
        f = CACHE_DIR / f"{key}.npy"
        if f.exists():
            saved = np.load(f)
            if saved.shape == (len(pool),):
                bits = saved
    if bits is None:
        bits = _entropies(_to_codes(pool), _to_codes(cand))
        if heavy and cache:
            CACHE_DIR.mkdir(exist_ok=True)
            np.save(CACHE_DIR / f"{key}.npy", bits)

    order = sorted(range(len(pool)),
                   key=lambda i: (-bits[i], 0 if pool[i] in answer_set else 1, pool[i]))
    return [{"word": pool[i],
             "bits": round(float(bits[i]), 3),
             "is_answer": pool[i] in answer_set}
            for i in order[:top]]
