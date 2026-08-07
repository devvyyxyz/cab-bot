#!/usr/bin/env python3
"""
tierlist.py — Generate a brainrot tier-list image from a player's inventory.

Input (JSON via stdin):
{
  "user": "1559610713",
  "source": "team" | "pc",
  "entries": [
    {"nickname": "Ballerina Cappuccina", "species": "Ballerina Cappuccina", "level": 6, "iv": 0.85, "icon_url": "https://indieun.com/cab/icons/61.png"},
    ...
  ]
}

Output (stdout): JSON with {"ok": true, "path": "/path/to/tierlist.png", "tiers": {"S": [...], "A": [...], ...}}
"""

import sys
import os
import json
import io
import urllib.request
import urllib.error
import hashlib
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------- Tier definitions ----------
# S = top 20%, A = next 20%, B = next 25%, C = next 25%, D = bottom 10%.
# Score combines IV and Level to give a 0-100 value.
TIERS = ["S", "A", "B", "C", "D"]
TIER_COLORS = {
    "S": (255, 87, 87),    # red
    "A": (255, 165, 87),   # orange
    "B": (255, 223, 87),   # yellow
    "C": (140, 220, 100),  # green
    "D": (160, 160, 160),  # gray
}
TIER_BG = (40, 40, 50)
CARD_BG = (60, 60, 70)
TEXT_LIGHT = (240, 240, 245)
TEXT_DIM = (180, 180, 190)
DIVIDER = (30, 30, 40)

# Cache icons in a temp dir to avoid re-downloading within a run.
ICON_CACHE = Path(tempfile.gettempdir()) / "brainrot-icons-cache"
ICON_CACHE.mkdir(parents=True, exist_ok=True)


def fetch_icon(url: str) -> Path:
    """Download an icon (cached on disk by URL hash). Returns local Path."""
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    cached = ICON_CACHE / f"{h}.png"
    if cached.exists() and cached.stat().st_size > 100:
        return cached
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BrainrotBot/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read()
        cached.write_bytes(data)
        return cached
    except Exception:
        return None


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Try a few system fonts in order of preference."""
    candidates = []
    if bold:
        candidates += [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ]
    candidates += [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def score_entry(e: dict) -> float:
    """0-100 score: IV dominates (60%), Level contributes (40%)."""
    iv = float(e.get("iv", 0) or 0)
    lvl = float(e.get("level", 1) or 1)
    # IV is 0-1, scale to 0-60
    iv_score = max(0, min(1, iv)) * 60
    # Level is 1-100, scale to 0-40
    lvl_score = (max(1, min(100, lvl)) - 1) / 99 * 40
    return iv_score + lvl_score


def assign_tiers(entries: list) -> dict:
    """Sort by score desc and bucket into tiers. Returns {tier: [entries]}."""
    if not entries:
        return {t: [] for t in TIERS}
    scored = sorted(entries, key=lambda e: score_entry(e), reverse=True)
    n = len(scored)
    # Bucket boundaries — top 20% S, next 20% A, next 25% B, next 25% C, bottom 10% D.
    # Use ceiling so small N still spreads across tiers reasonably.
    import math
    s_end = max(1, math.ceil(n * 0.20))
    a_end = s_end + max(1, math.ceil(n * 0.20))
    b_end = a_end + max(1, math.ceil(n * 0.25))
    c_end = b_end + max(1, math.ceil(n * 0.25))
    # D = remainder (could be 0)
    buckets = {
        "S": scored[:s_end],
        "A": scored[s_end:a_end],
        "B": scored[a_end:b_end],
        "C": scored[b_end:c_end],
        "D": scored[c_end:],
    }
    # Filter out empty tiers at the bottom (don't render D if all entries are good)
    return buckets


def render_tierlist(user: str, source: str, buckets: dict, out_path: str) -> None:
    """Render the tier-list image and save to out_path."""
    # Layout constants
    CARD_SIZE = 110        # square card
    CARD_GAP = 8           # gap between cards
    TIER_LABEL_W = 90      # left column width for "S" / "A" / etc.
    PADDING = 16
    HEADER_H = 70
    ROW_GAP = 8
    MAX_CARDS_PER_ROW = 12  # if a tier has more, we just show 12 (rare case)

    # Count cards per tier (capped)
    tier_counts = {t: min(len(buckets[t]), MAX_CARDS_PER_ROW) for t in TIERS}
    # Compute row width
    max_cards_in_any_tier = max(tier_counts.values()) if tier_counts else 1
    content_w = TIER_LABEL_W + CARD_GAP + max_cards_in_any_tier * (CARD_SIZE + CARD_GAP)
    total_w = PADDING * 2 + content_w
    total_h = PADDING * 2 + HEADER_H + len(TIERS) * (CARD_SIZE + ROW_GAP + 8) + 30

    img = Image.new("RGB", (total_w, total_h), (24, 24, 32))
    draw = ImageDraw.Draw(img)

    # Fonts
    font_header = get_font(28, bold=True)
    font_subhead = get_font(14)
    font_tier = get_font(48, bold=True)
    font_card_name = get_font(11)
    font_card_meta = get_font(10, bold=True)

    # Header
    draw.text((PADDING, PADDING), f"Tier List — {user}", font=font_header, fill=TEXT_LIGHT)
    sub = f"Source: {source.upper()}  •  {sum(len(buckets[t]) for t in TIERS)} entries  •  scored by IV + Level"
    draw.text((PADDING, PADDING + 36), sub, font=font_subhead, fill=TEXT_DIM)

    # Tier rows
    y = PADDING + HEADER_H
    for tier in TIERS:
        entries = buckets.get(tier, [])
        # Tier label box
        draw.rectangle(
            [PADDING, y, PADDING + TIER_LABEL_W, y + CARD_SIZE],
            fill=TIER_COLORS[tier],
            outline=DIVIDER,
        )
        # Center letter
        bbox = draw.textbbox((0, 0), tier, font=font_tier)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = PADDING + (TIER_LABEL_W - tw) // 2
        ty = y + (CARD_SIZE - th) // 2 - bbox[1]
        # Outline the letter for contrast
        for dx, dy in [(-2,0),(2,0),(0,-2),(0,2)]:
            draw.text((tx+dx, ty+dy), tier, font=font_tier, fill=(0,0,0,180))
        draw.text((tx, ty), tier, font=font_tier, fill=(255,255,255))

        # Cards
        x = PADDING + TIER_LABEL_W + CARD_GAP
        for entry in entries[:MAX_CARDS_PER_ROW]:
            # Card background
            draw.rectangle([x, y, x + CARD_SIZE, y + CARD_SIZE], fill=CARD_BG, outline=DIVIDER)

            # Try to load + paste icon
            icon_url = entry.get("icon_url")
            icon_path = fetch_icon(icon_url) if icon_url else None
            if icon_path and icon_path.exists():
                try:
                    icon = Image.open(icon_path).convert("RGBA")
                    # Fit into the top portion of the card (icon area = top 75px)
                    icon_area = 75
                    icon.thumbnail((icon_area, icon_area), Image.LANCZOS)
                    # Center horizontally, top-aligned
                    ix = x + (CARD_SIZE - icon.width) // 2
                    iy = y + 4
                    # Paste with alpha
                    img.paste(icon, (ix, iy), icon)
                except Exception:
                    pass
            else:
                # Placeholder box
                draw.rectangle([x+10, y+10, x+CARD_SIZE-10, y+85], fill=(80,80,90))

            # Name label below icon (truncated to fit)
            name = entry.get("nickname") or entry.get("species") or "?"
            # Truncate to ~16 chars
            short = name if len(name) <= 16 else name[:15] + "…"
            nbbox = draw.textbbox((0,0), short, font=font_card_name)
            nw = nbbox[2] - nbbox[0]
            nx = x + (CARD_SIZE - nw) // 2
            draw.text((nx, y + 80), short, font=font_card_name, fill=TEXT_LIGHT)

            # Meta: Lvl + IV%
            lvl = entry.get("level", "?")
            iv = entry.get("iv", 0)
            iv_pct = round(iv * 100) if isinstance(iv, (int, float)) else "?"
            meta = f"L{lvl} {iv_pct}%"
            mbbox = draw.textbbox((0,0), meta, font=font_card_meta)
            mw = mbbox[2] - mbbox[0]
            mx = x + (CARD_SIZE - mw) // 2
            # Color-code IV: high=green, mid=yellow, low=red
            if isinstance(iv_pct, int):
                if iv_pct >= 80: meta_color = (100, 220, 100)
                elif iv_pct >= 50: meta_color = (220, 200, 100)
                else: meta_color = (220, 120, 100)
            else:
                meta_color = TEXT_DIM
            draw.text((mx, y + 95), meta, font=font_card_meta, fill=meta_color)

            x += CARD_SIZE + CARD_GAP

        # If tier has more entries than shown, indicate
        hidden = len(entries) - MAX_CARDS_PER_ROW
        if hidden > 0:
            draw.text((x + 4, y + CARD_SIZE // 2 - 8), f"+{hidden}", font=get_font(14, bold=True), fill=TEXT_DIM)

        y += CARD_SIZE + ROW_GAP + 8

    # Footer
    draw.text((PADDING, y + 4), "Brainrot Bot • tierlist", font=get_font(10), fill=TEXT_DIM)

    # Save
    img.save(out_path, "PNG", optimize=True)


def main():
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad stdin JSON: {e}"}))
        sys.exit(1)

    user = payload.get("user", "unknown")
    source = payload.get("source", "team")
    entries = payload.get("entries", [])

    if not entries:
        print(json.dumps({"ok": False, "error": "no entries to tier"}))
        sys.exit(1)

    # Each entry must have icon_url. If missing, derive from species if possible.
    # The caller (Node bot) is expected to fill icon_url.

    buckets = assign_tiers(entries)

    # Use the same output directory as the Node bot (TIERLIST_OUT_DIR).
    # Fall back to a local "tierlists" dir relative to this script.
    out_dir = Path(os.environ.get("TIERLIST_OUT_DIR", str(Path(__file__).resolve().parent.parent / "tierlists")))
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"tierlist_{user}_{source}_{os.getpid()}.png"

    render_tierlist(user, source, buckets, str(out_path))

    tier_summary = {t: [e.get("nickname") or e.get("species", "?") for e in buckets[t]] for t in TIERS}
    print(json.dumps({
        "ok": True,
        "path": str(out_path),
        "tiers": tier_summary,
        "total": len(entries),
    }))


if __name__ == "__main__":
    main()
