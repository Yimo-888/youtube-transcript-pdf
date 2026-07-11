#!/usr/bin/env python3
"""Generate the extension toolbar icons (16/48/128 px) with no third-party deps.
Draws a rounded red square with a white 'download' arrow. Run: python3 generate_icons.py
"""
import os
import struct
import zlib

BG = (196, 48, 43)      # YouTube-ish red
FG = (255, 255, 255)     # white arrow


def in_rounded_rect(x, y, s, r):
    lo, hi = r, s - 1 - r
    dx = lo - x if x < lo else (x - hi if x > hi else 0)
    dy = lo - y if y < lo else (y - hi if y > hi else 0)
    return dx * dx + dy * dy <= r * r


def render(size):
    px = bytearray(size * size * 4)  # RGBA, transparent by default

    def put(x, y, c):
        xi, yi = int(round(x)), int(round(y))
        if 0 <= xi < size and 0 <= yi < size:
            i = (yi * size + xi) * 4
            px[i], px[i + 1], px[i + 2], px[i + 3] = c[0], c[1], c[2], 255

    r = size * 0.22
    for y in range(size):
        for x in range(size):
            if in_rounded_rect(x, y, size, r):
                put(x, y, BG)

    cx = size / 2.0
    # arrow stem
    stem_w = max(1.0, size * 0.10)
    for yy in range(int(size * 0.22), int(size * 0.55)):
        x0, x1 = cx - stem_w / 2, cx + stem_w / 2
        xx = x0
        while xx <= x1:
            put(xx, yy, FG)
            xx += 0.5
    # arrowhead (downward triangle)
    head_top, head_bot, head_half = size * 0.48, size * 0.70, size * 0.19
    yy = head_top
    while yy <= head_bot:
        t = (yy - head_top) / (head_bot - head_top)
        half = head_half * (1 - t)
        xx = cx - half
        while xx <= cx + half:
            put(xx, yy, FG)
            xx += 0.5
        yy += 0.5
    # tray / underline
    tray_y, tray_w, tray_h = size * 0.76, size * 0.46, max(1.0, size * 0.08)
    yy = tray_y
    while yy < tray_y + tray_h:
        xx = cx - tray_w / 2
        while xx <= cx + tray_w / 2:
            put(xx, yy, FG)
            xx += 0.5
        yy += 0.5
    return px


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))


def write_png(path, size, px):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0
        raw.extend(px[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
           chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
    os.makedirs(out, exist_ok=True)
    for s in (16, 48, 128):
        write_png(os.path.join(out, f"icon{s}.png"), s, render(s))
        print(f"wrote icons/icon{s}.png")


if __name__ == "__main__":
    main()
