"""Pattern matching with correct duplicate-letter semantics.

Pattern digits: 2 = green (correct), 1 = yellow (elsewhere), 0 = gray (absent).
Greens are matched first; the secret's remaining letters are consumed
left-to-right by yellow positions before grays are judged.
"""

PATTERN_DIGITS = set("012")


def pattern_for(guess, secret):
    """Feedback the secret would give for this guess."""
    pattern = ["0"] * 5
    remaining = []
    for i, (g, s) in enumerate(zip(guess.lower(), secret.lower())):
        if g == s:
            pattern[i] = "2"
        else:
            remaining.append(s)
    for i, g in enumerate(guess.lower()):
        if pattern[i] == "2":
            continue
        if g in remaining:
            pattern[i] = "1"
            remaining.remove(g)
    return "".join(pattern)


def matches(candidate, guess, pattern):
    """True if `candidate` could be the secret given one guess's feedback."""
    if len(guess) != 5 or len(pattern) != 5 or not set(pattern) <= PATTERN_DIGITS:
        return False
    guess = guess.lower()
    remaining = []
    for i, (c, g) in enumerate(zip(candidate, guess)):
        if pattern[i] == "2":
            if c != g:
                return False
        else:
            remaining.append(c)
    for i, g in enumerate(guess):
        if pattern[i] == "2":
            continue
        if pattern[i] == "1":
            if g not in remaining:
                return False
            remaining.remove(g)
    for i, g in enumerate(guess):
        if pattern[i] == "0" and g in remaining:
            return False
    return True


def filter_candidates(candidates, guess, pattern):
    """All candidates consistent with the given guess + feedback."""
    return [c for c in candidates if matches(c, guess, pattern)]
