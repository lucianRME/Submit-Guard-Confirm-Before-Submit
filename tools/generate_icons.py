#!/usr/bin/env python3

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRS = [
    ROOT / "assets",
    ROOT / "extension" / "assets",
]
SIZES = [16, 48, 128]
SUPERSAMPLE = 4

SHIELD_POINTS = [
    (0.5, 0.05),
    (0.84, 0.18),
    (0.8, 0.56),
    (0.5, 0.92),
    (0.2, 0.56),
    (0.16, 0.18),
]
CHECK_POINTS = [
    (0.31, 0.52),
    (0.44, 0.66),
    (0.71, 0.35),
]


def main():
    for size in SIZES:
        png_bytes = render_icon(size)
        for output_dir in OUTPUT_DIRS:
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / f"icon{size}.png").write_bytes(png_bytes)


def render_icon(size):
    width = size
    height = size
    data = bytearray()

    for y in range(height):
        data.append(0)
        for x in range(width):
            r, g, b, a = sample_pixel(size, x, y)
            data.extend((r, g, b, a))

    return encode_png(width, height, bytes(data))


def sample_pixel(size, x, y):
    total_r = 0.0
    total_g = 0.0
    total_b = 0.0
    total_a = 0.0
    samples = SUPERSAMPLE * SUPERSAMPLE

    for sy in range(SUPERSAMPLE):
        for sx in range(SUPERSAMPLE):
            u = (x + (sx + 0.5) / SUPERSAMPLE) / size
            v = (y + (sy + 0.5) / SUPERSAMPLE) / size
            r, g, b, a = shade_sample(u, v)
            total_r += r * a
            total_g += g * a
            total_b += b * a
            total_a += a

    if total_a <= 0.0:
        return 0, 0, 0, 0

    alpha = total_a / samples
    red = total_r / total_a
    green = total_g / total_a
    blue = total_b / total_a

    return (
        clamp_channel(red * 255.0),
        clamp_channel(green * 255.0),
        clamp_channel(blue * 255.0),
        clamp_channel(alpha * 255.0),
    )


def shade_sample(u, v):
    color = (0.0, 0.0, 0.0, 0.0)

    if point_in_polygon(u, v, SHIELD_POINTS):
        gradient_t = clamp((v - 0.02) / 0.9)
        base = lerp_color((17 / 255, 65 / 255, 96 / 255), (14 / 255, 116 / 255, 144 / 255), gradient_t)
        edge_distance = polygon_edge_distance(u, v, SHIELD_POINTS)
        border_mix = smoothstep(0.0, 0.04, edge_distance)
        fill = lerp_color((8 / 255, 37 / 255, 54 / 255), base, border_mix)

        highlight_distance = distance_to_circle(u, v, 0.42, 0.2, 0.28)
        highlight_alpha = 0.14 * (1.0 - smoothstep(0.0, 0.12, highlight_distance))
        color = blend(color, fill + (1.0,))
        color = blend(color, (1.0, 1.0, 1.0, highlight_alpha))

    shadow_alpha = check_alpha(u + 0.015, v + 0.02, 0.11) * 0.22
    if shadow_alpha > 0.0:
        color = blend(color, (2 / 255, 44 / 255, 59 / 255, shadow_alpha))

    mark_alpha = check_alpha(u, v, 0.11)
    if mark_alpha > 0.0:
        color = blend(color, (1.0, 1.0, 1.0, mark_alpha))

    return color


def check_alpha(u, v, thickness):
    radius = thickness / 2.0
    distances = [
        distance_to_segment(u, v, CHECK_POINTS[0], CHECK_POINTS[1]),
        distance_to_segment(u, v, CHECK_POINTS[1], CHECK_POINTS[2]),
        distance_to_circle(u, v, CHECK_POINTS[0][0], CHECK_POINTS[0][1], radius),
        distance_to_circle(u, v, CHECK_POINTS[1][0], CHECK_POINTS[1][1], radius),
        distance_to_circle(u, v, CHECK_POINTS[2][0], CHECK_POINTS[2][1], radius),
    ]
    distance = min(distances)
    return 1.0 - smoothstep(radius - 0.02, radius + 0.01, distance)


def blend(base, overlay):
    br, bg, bb, ba = base
    or_, og, ob, oa = overlay
    out_a = oa + ba * (1.0 - oa)
    if out_a <= 0.0:
        return 0.0, 0.0, 0.0, 0.0

    out_r = (or_ * oa + br * ba * (1.0 - oa)) / out_a
    out_g = (og * oa + bg * ba * (1.0 - oa)) / out_a
    out_b = (ob * oa + bb * ba * (1.0 - oa)) / out_a
    return out_r, out_g, out_b, out_a


def point_in_polygon(x, y, points):
    inside = False
    point_count = len(points)
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % point_count]
        intersects = ((y1 > y) != (y2 > y)) and (
            x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1
        )
        if intersects:
            inside = not inside
    return inside


def polygon_edge_distance(x, y, points):
    distances = []
    point_count = len(points)
    for index, start in enumerate(points):
        end = points[(index + 1) % point_count]
        distances.append(distance_to_segment(x, y, start, end))
    return min(distances)


def distance_to_segment(x, y, start, end):
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    length_squared = dx * dx + dy * dy
    if length_squared == 0.0:
        return math.hypot(x - x1, y - y1)

    projection = ((x - x1) * dx + (y - y1) * dy) / length_squared
    projection = clamp(projection)
    nearest_x = x1 + projection * dx
    nearest_y = y1 + projection * dy
    return math.hypot(x - nearest_x, y - nearest_y)


def distance_to_circle(x, y, cx, cy, radius):
    return abs(math.hypot(x - cx, y - cy) - radius)


def lerp_color(left, right, t):
    return tuple(lerp(left[index], right[index], t) for index in range(3))


def lerp(left, right, t):
    return left + (right - left) * t


def smoothstep(edge0, edge1, value):
    if edge0 == edge1:
        return 0.0
    t = clamp((value - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def clamp(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, value))


def clamp_channel(value):
    return max(0, min(255, round(value)))


def encode_png(width, height, image_data):
    signature = b"\x89PNG\r\n\x1a\n"
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    compressed = zlib.compress(image_data, 9)
    return signature + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", compressed) + png_chunk(b"IEND", b"")


def png_chunk(chunk_type, data):
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


if __name__ == "__main__":
    main()
