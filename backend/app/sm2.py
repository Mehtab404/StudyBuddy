from dataclasses import dataclass
from datetime import date, timedelta

MIN_EASE = 1.3

# SM-2 grades answers 0-5 and treats 3+ as a pass. The quiz has three buttons, which use the grades that mean
# "failed to recall" (1), "recalled it" (4) and "recalled it easily" (5).
# Only an easy answer raises the ease factor (+0.1). A plain "recalled it" leaves it unchanged and a failure lowers it
# (-0.54), so without the easy button every card could only get harder.
QUALITY_KNEW = 4
QUALITY_EASY = 5
QUALITY_DIDNT = 1


@dataclass
class Schedule:
    ease_factor: float
    interval_days: int
    repetitions: int
    due_date: date


def next_schedule(
    ease_factor: float, interval_days: int, repetitions: int, knew: bool, today: date, easy: bool = False
) -> Schedule:
    quality = (QUALITY_EASY if easy else QUALITY_KNEW) if knew else QUALITY_DIDNT

    if quality >= 3:
        if repetitions == 0:
            interval = 1
        elif repetitions == 1:
            interval = 6
        else:
            interval = round(interval_days * ease_factor)
        repetitions += 1
    else:
        # Failed: start the card's streak over and see it again tomorrow
        repetitions = 0
        interval = 1

    ease_factor = max(MIN_EASE, ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))

    return Schedule(ease_factor, interval, repetitions, today + timedelta(days=interval))
