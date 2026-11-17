"""Recognize a printed whole-sheet scale when the captions agree."""
import re
from math import isfinite

from .domain import Calibration

ARCHITECTURAL = re.compile(
    r'(?:(\d+)\s+)?(\d+(?:\.\d+)?)\s*(?:/\s*(\d+))?\s*"\s*=\s*'
    r"""(?:(\d+(?:\.\d+)?)\s*'\s*(?:-?\s*(\d+(?:\.\d+)?)\s*")?|(\d+(?:\.\d+)?)\s*")"""
)
RATIO = re.compile(r"(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)")
CAPTION = re.compile(r"\b(?:floor plan|ceiling plan|site plan|demo(?:lition)? plan|roof plan|foundation plan)\b", re.I)
UNCERTAIN = re.compile(r"n\.?\s*t\.?\s*s\.?|not to scale|as indicated|varies", re.I)
NORMALIZE = str.maketrans('“”″‘’′–−', '"""\'\'\'--')


def printed_scale(labels, width, height):
    result = None
    for label in labels:
        text = label["text"].strip().translate(NORMALIZE)
        prefix = re.match(r"scale(?:\s*:\s*|\s+)", text, re.I)
        value = text[prefix.end():] if prefix else text
        if UNCERTAIN.fullmatch(value):
            return None
        imperial, ratio = ARCHITECTURAL.fullmatch(value), RATIO.fullmatch(value)
        if not (imperial or ratio):
            if prefix and re.match(r"(?:\d|\.\d).*(?:=|:)", value):
                return None
            continue
        x, y = label["bounds"][:2]
        if not prefix and not any(
            other is not label and len(other["text"]) < 100 and CAPTION.search(other["text"])
            and abs(x - other["bounds"][0]) <= 115 and abs(y - other["bounds"][1]) <= 40
            for other in labels
        ):
            if imperial:
                return None
            continue
        if imperial:
            whole, numerator, denominator, ft, inches, only_inches = imperial.groups()
            divisor = float(denominator or 1)
            if not divisor:
                return None
            points = 72 * (float(whole or 0) + float(numerator) / divisor)
            feet = float(ft or 0) + float(inches or only_inches or 0) / 12
        else:
            if not float(ratio[1]):
                return None
            points, feet = 72, float(ratio[2]) / float(ratio[1]) / 12
        if not isfinite(points) or not isfinite(feet) or not 0 < points <= width or feet <= 0 or height <= 0:
            return None
        if result:
            if abs(result.factor - feet / points) > result.factor * 1e-9:
                return None
        else:
            result = Calibration(points=[(0, 0), (points, 0)], feet=feet, source=f"Printed scale: {text}")
    return result
