"""Draw a top-down preview of a Nidorama home.json (independent of any app code). Usage: preview_home.py home.json out.png"""
import json, math, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle, Circle

H = json.load(open(sys.argv[1])); L = H["levels"][0]
FL = {"timber-dark": "#6e5341", "marble-tile": "#ebebe8", "mosaic-tile": "#dfe3e3", "decking": "#a98463", "stair-void": "#2a211b"}
fig, ax = plt.subplots(figsize=(8, 13), dpi=110)
for r in L["rooms"]:
    ax.add_patch(Polygon(r["polygon"], fc=FL.get(r["floor"], "#888"), ec="none", zorder=0))
for f in L["floors"]:
    x0, y0, x1, y1 = f["rect"]; ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc=FL[f["material"]], ec="none", zorder=0.5))
for v in L["voids"]:
    x0, y0, x1, y1 = v["rect"]; ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc="#1d1713", ec="none", zorder=0.6))
for o in sorted(L["objects"], key=lambda o: o["bounds"]["max"][2]):
    for p in o["parts"]:
        (x0, y0, _), (x1, y1, _) = p["min"], p["max"]
        a = min(1, max(.25, p.get("opacity", 1)))
        if p.get("shape") == "cylinder":
            ax.add_patch(Circle(((x0 + x1) / 2, (y0 + y1) / 2), (x1 - x0) / 2, fc=p["color"], ec="#0003", lw=.3, alpha=a, zorder=1 + p["max"][2]))
        else:
            ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc=p["color"], ec="#0003", lw=.3, alpha=a, zorder=1 + p["max"][2]))
for w in L["walls"]:
    (ax_, ay), (bx, by) = w["a"], w["b"]; L_ = math.hypot(bx - ax_, by - ay); ux, uy = (bx - ax_) / L_, (by - ay) / L_
    nx, ny = -uy * w["thickness"] / 2, ux * w["thickness"] / 2
    cuts = sorted((o["offset"], o["offset"] + o["width"], o) for o in w["openings"]); pos = 0
    for s, e, o in cuts + [(L_, L_, None)]:
        if s > pos:
            p0 = (ax_ + ux * pos, ay + uy * pos); p1 = (ax_ + ux * s, ay + uy * s)
            ax.add_patch(Polygon([(p0[0] + nx, p0[1] + ny), (p1[0] + nx, p1[1] + ny), (p1[0] - nx, p1[1] - ny), (p0[0] - nx, p0[1] - ny)], fc="#f4f1ea", ec="#555", lw=.4, zorder=10))
        if o and o["type"] in ("window", "slider"):
            p0 = (ax_ + ux * s, ay + uy * s); p1 = (ax_ + ux * e, ay + uy * e)
            ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color="#7cc4ec", lw=2.5, zorder=10)
        pos = max(pos, e)
for l in L["lights"]:
    if "position" in l:
        ax.add_patch(Circle(l["position"][:2], .12, fc="#ffcf6e", ec="#b07a10", lw=.8, zorder=12))
        ax.annotate(l["name"], l["position"][:2], fontsize=5, color="#000", zorder=13, xytext=(4, 4), textcoords="offset points",
                    bbox=dict(boxstyle="round,pad=.15", fc="#fff", ec="none", alpha=.8))
for r in L["rooms"]:
    ax.text(*r["labelAt"], r["name"].upper(), fontsize=7, weight="bold", color="#fff", ha="center", zorder=14,
            bbox=dict(boxstyle="round,pad=.2", fc="#0008", ec="none"))
ax.set_xlim(-.4, 8.4); ax.set_ylim(13.2, -1.8); ax.set_aspect("equal"); ax.axis("off")
ax.set_title(f"{H['name']} · {L['name']} — drawn from home.json", fontsize=9)
fig.savefig(sys.argv[2], bbox_inches="tight")
