"""Download and cache Wordle word lists.

answers.txt  : curated list of possible answers (~2,300 words)
words_en.txt : extended list of valid guesses (~14,800 words, superset of answers)
"""
import pathlib
import re
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ANSWERS_FILE = HERE / "answers.txt"
GUESSES_FILE = HERE / "words_en.txt"

ANSWER_URL = "https://raw.githubusercontent.com/LaurentLessard/wordlesolver/main/solutions_nyt.txt"
GUESS_URL = "https://raw.githubusercontent.com/tabatkins/wordle-list/main/words"


def _fetch(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read().decode()


def _parse_answers(text):
    # the source is a quoted, comma-separated list (with or without brackets)
    return re.findall(r"\b[a-z]{5}\b", text.lower())


def _parse_guesses(text):
    return [w.strip().lower() for w in text.split() if len(w.strip()) == 5]


def load_words(force=False):
    """Return (answers, guesses); downloads and caches on first run."""
    if force or not ANSWERS_FILE.exists() or not GUESSES_FILE.exists():
        answers = _parse_answers(_fetch(ANSWER_URL))
        guesses = _parse_guesses(_fetch(GUESS_URL))
        ANSWERS_FILE.write_text("\n".join(sorted(set(answers))) + "\n")
        GUESSES_FILE.write_text("\n".join(sorted(set(guesses))) + "\n")
        print(f"[words] cached {len(set(answers))} answers, {len(set(guesses))} guesses")
    answers = ANSWERS_FILE.read_text().split()
    guesses = GUESSES_FILE.read_text().split()
    # every answer must also be a legal guess
    guesses = sorted(set(guesses) | set(answers))
    return answers, guesses


if __name__ == "__main__":
    a, g = load_words()
    print(f"{len(a)} answers, {len(g)} total guessable words")
