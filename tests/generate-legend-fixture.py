"""Create a vector PDF with ordinary demolition legend labels."""
from pathlib import Path

import pymupdf as pdf

output = Path(__file__).with_name("demolition-legend.pdf")
doc = pdf.open()
page = doc.new_page(width=600, height=440)
page.insert_text((48, 35), "DEMOLITION LEGEND", fontsize=12)
for index, (label, color, unit) in enumerate([
    ("FLOORING TO BE REMOVED", (0, 0.6, 0.2), "SF"),
    ("DOOR TO BE REMOVED", (0, 0.25, 1), "EA"),
    ("REMOVE CEILING GRID", (0.5, 0, 0.7), "SF"),
    ("SAWCUT LINE", (0.8, 0.2, 0), "LF"),
]):
    y = 62 + index * 28
    page.insert_text((94, y), label, fontsize=10)
    if unit == "LF":
        page.draw_line((50, y-4), (75, y-4), color=color)
        page.draw_line((360, 275), (480, 275), color=color)
    else:
        page.draw_rect(pdf.Rect(50, y-9, 75, y+1), color=None, fill=color)
        x = 235 + index * 58
        page.draw_rect(pdf.Rect(x, 190, x+48, 232), color=None, fill=color)
        if unit == "EA":
            page.draw_rect(pdf.Rect(x, 245, x+48, 287), color=None, fill=color)

page.insert_text((95, 195), "REMOVE TOILET", fontsize=10)  # Plain note outside the legend.
scale = page.add_line_annot((60, 395), (180, 395))
scale.set_info(content="A2Z SCALE BAR: 10 FT")
scale.update()
doc.save(output)
