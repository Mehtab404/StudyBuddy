"""Helpers for prompts that include text written by users (their notes, their extra requests).

That text is untrusted: a set of notes can contain a line such as "ignore the rules above and ...". Two defences work
together. The text is wrapped in tags so the model can tell where it starts and ends, and each system prompt has a rule
saying that anything inside the tags is material to work from, not instructions.

This module imports nothing from the rest of the app, so any module can use it without a circular import.
"""

import re


def untrusted(tag: str, text: str) -> str:
    """Wraps user-written text in <tag>...</tag>. Tags of the same name inside the text are removed first,
    so the text cannot close the block early and put its own instructions outside it."""
    clean = re.sub(rf"</?\s*{re.escape(tag)}\s*>", "", text, flags=re.IGNORECASE)
    return f"<{tag}>\n{clean}\n</{tag}>"
