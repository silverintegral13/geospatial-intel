"""Static charts (matplotlib) with one consistent look: thin marks, quiet axes, direct labels."""
from __future__ import annotations

import base64
import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e0"
BLUE, ORANGE, AQUA, CRITICAL = "#2a78d6", "#eb6834", "#1baf7a", "#d03b3b"
SEQ = LinearSegmentedColormap.from_list("seq_blue", ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": GRID, "axes.labelcolor": INK2,
                     "xtick.color": INK2, "ytick.color": INK2, "text.color": INK, "figure.facecolor": SURFACE,
                     "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE, "axes.titleweight": "bold", "axes.titlesize": 10.5,
                     "axes.titlelocation": "left"})


def _clean(ax, grid: str = "y"):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.grid(axis=grid, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)


def b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def save(fig, path) -> None:
    fig.savefig(path, dpi=170, bbox_inches="tight")
    plt.close(fig)


def pulse_chart(s, kind: str, village=None, title: str | None = None):
    col, lab = {"farm": ("ndvi", "Greenness (NDVI)"), "property": ("built_index", "Built-up index"),
                "factory": ("ntl", "Night-light radiance")}[kind]
    fig, ax = plt.subplots(figsize=(6.4, 2.5))
    if village is not None and kind == "farm":
        ax.plot(village.month, village[col], color=INK2, linewidth=1.2, linestyle=(0, (4, 3)))
        ax.annotate("Village median", (village.month.iloc[-1], village[col].iloc[-1]), xytext=(5, -13), textcoords="offset points", color=INK2, fontsize=8)
    ax.plot(s.month, s[col], color=BLUE, linewidth=2)
    ax.annotate("This plot", (s.month.iloc[-1], s[col].iloc[-1]), xytext=(5, 4), textcoords="offset points", color=INK, fontsize=8)
    import matplotlib.dates as mdates

    ax.xaxis.set_major_locator(mdates.MonthLocator(bymonth=[1, 7]))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    ax.set_ylabel(lab)
    ax.set_title(title or f"{lab}, last 36 months")
    ax.margins(x=0.02)
    ax.set_xlim(right=s.month.iloc[-1] + (s.month.iloc[-1] - s.month.iloc[0]) * 0.16)
    _clean(ax)
    return fig


def choropleth(gdf, col: str, title: str, label: str, names: str | None = None, points=None, figsize=(7.2, 6.2)):
    fig, ax = plt.subplots(figsize=figsize)
    gdf.plot(column=col, cmap=SEQ, linewidth=0.6, edgecolor=SURFACE, ax=ax, vmin=0, vmax=100, legend=True,
             legend_kwds={"label": label, "shrink": 0.55, "orientation": "horizontal", "pad": 0.02, "aspect": 30})
    if names:
        for _, r in gdf.iterrows():
            p = r.geometry.representative_point()
            ax.annotate(f"{r[names]}", (p.x, p.y), ha="center", va="center", fontsize=5.5,
                        color="#ffffff" if r[col] > 55 else INK)
    if points is not None:
        for _, r in points.iterrows():
            ax.plot(r.lon, r.lat, marker="o", markersize=7, markerfacecolor=ORANGE, markeredgecolor=SURFACE, markeredgewidth=1.5)
            ax.annotate(r.id, (r.lon, r.lat), xytext=(6, 5), textcoords="offset points", fontsize=8, fontweight="bold")
    ax.set_title(title)
    ax.set_axis_off()
    return fig


def grouped_bars(labels, a, b, name_a: str, name_b: str, title: str, ylabel: str, pct: bool = True):
    import numpy as np

    fig, ax = plt.subplots(figsize=(6.4, 3.0))
    x, w = np.arange(len(labels)), 0.36
    for off, vals, c, n in [(-w / 2 - 0.01, a, BLUE, name_a), (w / 2 + 0.01, b, ORANGE, name_b)]:
        bars = ax.bar(x + off, vals, w, color=c, label=n)
        for r, v in zip(bars, vals):
            ax.annotate(f"{100 * v:.0f}%" if pct else f"{v:.2f}", (r.get_x() + r.get_width() / 2, v), xytext=(0, 2),
                        textcoords="offset points", ha="center", fontsize=7.5, color=INK2)
    ax.set_xticks(x, labels)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(0, -0.12), ncols=2)
    _clean(ax)
    return fig


def simple_bars(labels, vals, title: str, ylabel: str, highlight: int | None = None):
    fig, ax = plt.subplots(figsize=(5.4, 2.8))
    colors = [BLUE if (highlight is None or i == highlight) else "#9ec5f4" for i in range(len(labels))]
    bars = ax.bar(labels, vals, 0.5, color=colors)
    for r, v in zip(bars, vals):
        ax.annotate(f"{v:.2f}", (r.get_x() + r.get_width() / 2, v), xytext=(0, 2), textcoords="offset points", ha="center", fontsize=8.5)
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    _clean(ax)
    return fig
