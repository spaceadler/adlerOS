"""Songs' tags, for adlerOS's Music: title, artists, album, track, year,
genre, length, and whether there's a cover or lyrics in it; the cover and
the lyrics themselves on request. MP3 (ID3v2.2-2.4, ID3v1), FLAC, Ogg
(Vorbis, Opus), MP4/M4A and WAV, with the standard library only.

read_tags(path) -> dict (never raises: a file it can't read gives {}).
read_cover(path) -> (mime, bytes) or None.
read_lyrics(path) -> str or None (an LRC's [mm:ss] times kept, if it has them).
"""
import base64
import struct

# ID3v1's genres, for TCON "(17)" and M4A's gnre.
GENRES = [
    "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal", "New Age",
    "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska",
    "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion",
    "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise",
    "Alternative Rock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock",
    "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream",
    "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native US",
    "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk",
    "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock",
]

ID3_TEXT = {  # v2.3/2.4 and v2.2 ids -> our names
    "TIT2": "title", "TT2": "title", "TPE1": "artist", "TP1": "artist", "TPE2": "albumArtist", "TP2": "albumArtist",
    "TALB": "album", "TAL": "album", "TRCK": "track", "TRK": "track", "TPOS": "disc", "TPA": "disc",
    "TDRC": "year", "TYER": "year", "TYE": "year", "TCON": "genre", "TCO": "genre", "TLEN": "length", "TLE": "length",
}
ID3_SKIP = {"APIC", "PIC", "GEOB", "GEO", "PRIV", "SYLT", "SLT", "USLT", "ULT", "MCDI", "MCI", "POPM", "POP", "COMM", "COM"}
COVER_NAMES = ("cover", "folder", "front", "album", "albumart")


def read_tags(path):
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            f.seek(0)
            if head[:3] == b"ID3" or path.suffix.lower() == ".mp3":
                tags = _mp3(f)
            elif head[:4] == b"fLaC":
                tags = _flac(f)
            elif head[:4] == b"OggS":
                tags = _ogg(f)
            elif head[4:8] == b"ftyp":
                tags = _mp4(f)
            elif head[:4] == b"RIFF" and head[8:12] == b"WAVE":
                tags = _wav(f)
            else:
                tags = {}
    except (OSError, ValueError, struct.error, IndexError, KeyError, UnicodeError, OverflowError):
        return {}
    return _tidy(tags)


def read_cover(path):
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            f.seek(0)
            if head[:3] == b"ID3":
                return _id3(f, want="cover")
            if head[:4] == b"fLaC":
                return _flac(f, want="cover")
            if head[:4] == b"OggS":
                return _ogg(f, want="cover")
            if head[4:8] == b"ftyp":
                return _mp4(f, want="cover")
    except (OSError, ValueError, struct.error, IndexError, KeyError, UnicodeError, OverflowError):
        return None
    return None


def read_lyrics(path):
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            f.seek(0)
            if head[:3] == b"ID3":
                found = _id3(f, want="lyrics")
            elif head[:4] == b"fLaC":
                found = _flac(f, want="lyrics")
            elif head[:4] == b"OggS":
                found = _ogg(f, want="lyrics")
            elif head[4:8] == b"ftyp":
                found = _mp4(f, want="lyrics")
            else:
                found = None
    except (OSError, ValueError, struct.error, IndexError, KeyError, UnicodeError, OverflowError):
        return None
    return (found.strip() or None) if isinstance(found, str) else None


# ------------------------------------------------------------------- tidy

def _number(value):
    """'3/13' -> 3; '' -> None."""
    digits = str(value or "").split("/")[0].strip()
    return int(digits) if digits.isdigit() and 0 < int(digits) < 10000 else None


def _genre(value):
    """'(17)', '17' or '(17)Rock' -> 'Rock'; 'Hip-Hop/Rap' as it is."""
    v = str(value or "").strip()
    while v.startswith("(") and ")" in v and v[1:v.index(")")].isdigit():
        n, rest = int(v[1:v.index(")")]), v[v.index(")") + 1:].strip()
        v = rest or (GENRES[n] if n < len(GENRES) else "")
    if v.isdigit():
        v = GENRES[int(v)] if int(v) < len(GENRES) else ""
    return v


def _tidy(t):
    out = {}
    for key in ("title", "albumArtist", "album"):
        v = t.get(key)
        if isinstance(v, list):
            v = v[0] if v else ""
        v = str(v or "").replace("\x00", "").strip()
        if v:
            out[key] = v[:500]
    artists = t.get("artist") or []
    if isinstance(artists, str):
        artists = [artists]
    names = []
    for a in artists:
        a = str(a).replace("\x00", "").strip()
        # ID3v2.3 joins artists with "/" (spotdl: "01099/Paul/Gustav"); not
        # a name that has one in it, like the album artist's AC/DC.
        parts = a.split("/") if "/" in a and t.get("split", True) and "/" not in str(out.get("albumArtist", "")) else [a]
        names += [p.strip() for p in parts if p.strip()]
    if names:
        out["artists"] = list(dict.fromkeys(names))[:20]
    for key in ("track", "disc"):
        n = _number(t.get(key))
        if n:
            out[key] = n
    year = str(t.get("year") or "").strip()[:4]
    if year.isdigit() and 1000 < int(year) < 3000:
        out["year"] = int(year)
    genre = _genre(t.get("genre"))
    if genre:
        out["genre"] = genre[:100]
    length = t.get("duration")
    if not length and str(t.get("length") or "").strip().isdigit():
        length = int(str(t["length"]).strip()) / 1000
    if length and 0 < length < 360000:
        out["duration"] = round(float(length), 1)
    if t.get("cover"):
        out["cover"] = True
    if t.get("lyrics"):
        out["lyrics"] = True
    return out


# --------------------------------------------------------------------- ID3

def _syncsafe(b):
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def _unsync(data):
    return data.replace(b"\xff\x00", b"\xff")


def _id3_text(body):
    """A text frame's values (v2.4 may have several, \\0 between)."""
    if not body:
        return []
    enc, raw = body[0], body[1:]
    if enc == 1 or enc == 2:
        codec = "utf-16" if enc == 1 else "utf-16-be"
        # Split on a UTF-16 \0 (an even pair), not any zero byte.
        parts, start = [], 0
        for i in range(0, len(raw) - 1, 2):
            if raw[i] == 0 and raw[i + 1] == 0:
                parts.append(raw[start:i])
                start = i + 2
        parts.append(raw[start:])
        values = [p.decode(codec, "replace") if p else "" for p in parts]  # each with its own BOM
    else:
        values = raw.decode("utf-8" if enc == 3 else "latin1", "replace").split("\x00")
    return [v.strip("﻿").strip() for v in values if v.strip("﻿").strip()]


def _id3_split_desc(enc, data):
    """(description, rest) for frames that start with a \\0-ended description."""
    if enc in (1, 2):
        for i in range(0, len(data) - 1, 2):
            if data[i] == 0 and data[i + 1] == 0:
                return data[:i], data[i + 2:]
        return data, b""
    i = data.find(b"\x00")
    return (data, b"") if i < 0 else (data[:i], data[i + 1:])


def _id3_decode(enc, data):
    codec = {0: "latin1", 1: "utf-16", 2: "utf-16-be", 3: "utf-8"}.get(enc, "latin1")
    return data.decode(codec, "replace").strip("﻿\x00")


def _id3(f, want="tags"):
    """The ID3v2 tag at f's start: tags (dict, with "end": where the audio
    starts), or the cover, or the lyrics."""
    head = f.read(10)
    if head[:3] != b"ID3" or head[3] not in (2, 3, 4):
        return {"end": 0} if want == "tags" else None
    ver, flags, size = head[3], head[5], _syncsafe(head[6:10])
    end = 10 + size + (10 if ver == 4 and flags & 0x10 else 0)
    whole_unsync = flags & 0x80 and ver < 4
    data = None
    if whole_unsync or ver == 2:
        data = f.read(size)
        if whole_unsync:
            data = _unsync(data)
    tags, synced = {"end": end}, []
    pos = 0
    if flags & 0x40 and ver >= 3:  # an extended header: past it
        if data is None:
            ext = f.read(4)
            n = _syncsafe(ext) if ver == 4 else struct.unpack(">I", ext)[0] + 4
            f.seek(n - 4, 1)
            pos = n
        else:
            n = _syncsafe(data[:4]) if ver == 4 else struct.unpack(">I", data[:4])[0] + 4
            pos = n
    idlen, hlen = (3, 6) if ver == 2 else (4, 10)
    while pos + hlen <= size:
        fh = data[pos:pos + hlen] if data is not None else f.read(hlen)
        if len(fh) < hlen or not fh[:idlen].strip(b"\x00") or not fh[:idlen].isalnum():
            break
        fid = fh[:idlen].decode("latin1")
        if ver == 2:
            fsize = int.from_bytes(fh[3:6], "big")
            fflags = 0
        else:
            fsize = _syncsafe(fh[4:8]) if ver == 4 else struct.unpack(">I", fh[4:8])[0]
            fflags = struct.unpack(">H", fh[8:10])[0]
        pos += hlen
        if fsize <= 0 or pos + fsize > size + 10:
            break
        need = (want == "tags" and fid not in ID3_SKIP) or (want == "cover" and fid in ("APIC", "PIC")) \
            or (want == "lyrics" and fid in ("USLT", "ULT", "SYLT", "SLT"))
        if data is not None:
            body = data[pos:pos + fsize] if need else b""
        elif need:
            body = f.read(fsize)
        else:
            f.seek(fsize, 1)
            body = b""
        pos += fsize
        if want == "tags" and fid in ("APIC", "PIC"):
            tags["cover"] = True
        if want == "tags" and fid in ("USLT", "ULT", "SYLT", "SLT"):
            tags["lyrics"] = True
        if not need:
            continue
        if ver == 4 and fflags & 0x0001:  # a data length indicator, first
            body = body[4:]
        if ver == 4 and fflags & 0x0002:
            body = _unsync(body)
        if ver != 2 and fflags & (0x0080 if ver == 3 else 0x0008):  # compressed: not worth it here
            continue
        if want == "cover":
            enc = body[0]
            if fid == "PIC":
                fmt, rest = body[1:4].decode("latin1").lower(), body[4:]
                mime = "image/png" if fmt == "png" else "image/jpeg"
                pic_type, rest = rest[0], rest[1:]
            else:
                i = body.find(b"\x00", 1)
                mime = body[1:i].decode("latin1").lower() or "image/jpeg"
                pic_type, rest = body[i + 1], body[i + 2:]
            _, image = _id3_split_desc(enc, rest)
            if image:
                found = (_image_mime(mime, image), image)
                if pic_type == 3:
                    return found  # the front cover
                tags.setdefault("_cover", found)
            continue
        if want == "lyrics":
            enc = body[0]
            if fid in ("USLT", "ULT"):
                _, text = _id3_split_desc(enc, body[4:])
                text = _id3_decode(enc, text)
                if text.strip():
                    return text
            else:
                synced.append(_sylt(body))
            continue
        name = ID3_TEXT.get(fid)
        if name:
            values = _id3_text(body)
            if values:
                tags[name] = values if name == "artist" else values[0]
                if name == "artist" and ver == 4:
                    tags["split"] = len(values) == 1  # v2.4 has its own way to list several
    if want == "cover":
        return tags.get("_cover")
    if want == "lyrics":
        return next((s for s in synced if s), None)
    return tags


def _sylt(body):
    """SYLT (synced lyrics, ms times) as LRC text."""
    enc, fmt = body[0], body[4]
    if fmt != 2:  # times in frames, not ms: not usable
        return ""
    _, rest = _id3_split_desc(enc, body[6:])
    lines = []
    while rest:
        text, rest = _id3_split_desc(enc, rest)
        if len(rest) < 4:
            break
        ms, rest = struct.unpack(">I", rest[:4])[0], rest[4:]
        lines.append(f"[{ms // 60000:02d}:{ms % 60000 / 1000:05.2f}]{_id3_decode(enc, text).strip()}")
    return "\n".join(lines)


def _image_mime(mime, data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return mime if mime in ("image/png", "image/jpeg", "image/webp", "image/gif") else "image/jpeg"


# --------------------------------------------------------------------- MP3

MP3_BITRATES = {  # (version 1 or 2, layer) -> kbps by index
    (1, 1): [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    (1, 2): [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    (1, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    (2, 1): [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    (2, 2): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
MP3_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def _mp3(f):
    tags = _id3(f)
    start = tags.pop("end", 0)
    f.seek(0, 2)
    size = f.tell()
    # No ID3v2: ID3v1 at the end, maybe.
    if not any(k in tags for k in ("title", "artist", "album")) and size > 128:
        f.seek(size - 128)
        v1 = f.read(128)
        if v1[:3] == b"TAG":
            field = lambda a, b: v1[a:b].split(b"\x00")[0].decode("latin1").strip()  # noqa: E731
            tags.update({k: v for k, v in (("title", field(3, 33)), ("artist", field(33, 63)), ("album", field(63, 93)),
                                            ("year", field(93, 97))) if v})
            if v1[125] == 0 and v1[126]:
                tags.setdefault("track", str(v1[126]))
            if v1[127] < len(GENRES):
                tags.setdefault("genre", GENRES[v1[127]])
            size -= 128
    if not tags.get("length"):
        tags["duration"] = _mp3_length(f, start, size)
    return tags


def _mp3_length(f, start, size):
    f.seek(start)
    buf = f.read(64 * 1024)
    for i in range(len(buf) - 4):
        if buf[i] != 0xFF or buf[i + 1] & 0xE0 != 0xE0:
            continue
        b1, b2, b3 = buf[i + 1], buf[i + 2], buf[i + 3]
        version_bits, layer_bits = (b1 >> 3) & 3, (b1 >> 1) & 3
        bitrate_index, rate_index = b2 >> 4, (b2 >> 2) & 3
        if version_bits == 1 or layer_bits == 0 or bitrate_index in (0, 15) or rate_index == 3:
            continue
        layer = 4 - layer_bits
        version = 1 if version_bits == 3 else 2
        kbps = MP3_BITRATES[(version, layer) if version == 1 else (2, 1 if layer == 1 else 2)][bitrate_index]
        rate = MP3_RATES[version_bits][rate_index]
        per_frame = 384 if layer == 1 else 1152 if layer == 2 or version == 1 else 576
        mono = (b3 >> 6) == 3
        side = (17 if mono else 32) if version == 1 else (9 if mono else 17)
        frame = buf[i:i + 200]
        # Xing/Info (VBR, and LAME's CBR): how many frames.
        x = 4 + side
        if frame[x:x + 4] in (b"Xing", b"Info") and struct.unpack(">I", frame[x + 4:x + 8])[0] & 1:
            frames = struct.unpack(">I", frame[x + 8:x + 12])[0]
            return frames * per_frame / rate
        if frame[36:40] == b"VBRI":
            frames = struct.unpack(">I", frame[50:54])[0]
            return frames * per_frame / rate
        return (size - start - i) * 8 / (kbps * 1000)
    return None


# -------------------------------------------------------------- FLAC, Ogg

def _vorbis_comments(data, tags, want="tags"):
    """A Vorbis comment block (FLAC's, Ogg's) into tags."""
    vendor = struct.unpack("<I", data[:4])[0]
    pos = 4 + vendor
    count = struct.unpack("<I", data[pos:pos + 4])[0]
    pos += 4
    for _ in range(min(count, 10000)):
        n = struct.unpack("<I", data[pos:pos + 4])[0]
        entry = data[pos + 4:pos + 4 + n]
        pos += 4 + n
        key, _, value = entry.partition(b"=")
        key = key.decode("ascii", "replace").upper()
        if key == "METADATA_BLOCK_PICTURE":
            tags["cover"] = True
            if want == "cover":
                try:
                    found = _flac_picture(base64.b64decode(value))
                except ValueError:
                    found = None
                if found:
                    tags.setdefault("_cover", found)
            continue
        value = value.decode("utf-8", "replace")
        if key in ("LYRICS", "UNSYNCEDLYRICS", "UNSYNCED LYRICS"):
            tags["lyrics"] = True
            tags.setdefault("_lyrics", value)
            continue
        name = {"TITLE": "title", "ARTIST": "artist", "ALBUMARTIST": "albumArtist", "ALBUM ARTIST": "albumArtist",
                "ALBUM": "album", "TRACKNUMBER": "track", "DISCNUMBER": "disc", "DATE": "year", "YEAR": "year",
                "GENRE": "genre"}.get(key)
        if name == "artist":
            tags.setdefault("artist", []).append(value)
            tags["split"] = False  # several ARTIST= when there are several
        elif name:
            tags.setdefault(name, value)


def _flac_picture(block):
    pic_type = struct.unpack(">I", block[:4])[0]
    n = struct.unpack(">I", block[4:8])[0]
    mime = block[8:8 + n].decode("ascii", "replace").lower()
    pos = 8 + n
    n = struct.unpack(">I", block[pos:pos + 4])[0]
    pos += 4 + n + 16
    n = struct.unpack(">I", block[pos:pos + 4])[0]
    image = block[pos + 4:pos + 4 + n]
    return (_image_mime(mime, image), image, pic_type) if image else None


def _pick_cover(found):
    if not found:
        return None
    return found[:2]


def _flac(f, want="tags"):
    if f.read(4) != b"fLaC":
        return {} if want == "tags" else None
    tags, covers = {}, []
    while True:
        head = f.read(4)
        if len(head) < 4:
            break
        last, kind, n = head[0] & 0x80, head[0] & 0x7F, int.from_bytes(head[1:4], "big")
        if kind == 0:
            info = f.read(n)
            rate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4)
            samples = ((info[13] & 0x0F) << 32) | struct.unpack(">I", info[14:18])[0]
            if rate and samples:
                tags["duration"] = samples / rate
        elif kind == 4:
            _vorbis_comments(f.read(n), tags, want)
        elif kind == 6:
            tags["cover"] = True
            if want == "cover":
                found = _flac_picture(f.read(n))
                if found:
                    covers.append(found)
            else:
                f.seek(n, 1)
        else:
            f.seek(n, 1)
        if last:
            break
    if want == "cover":
        front = next((c for c in covers if c[2] == 3), covers[0] if covers else tags.get("_cover"))
        return _pick_cover(front)
    if want == "lyrics":
        return tags.get("_lyrics")
    return tags


def _ogg_packets(f, limit=8 * 1024 * 1024):
    """The first packets of an Ogg stream (as many as fit in limit)."""
    packet, read = b"", 0
    while read < limit:
        head = f.read(27)
        if len(head) < 27 or head[:4] != b"OggS":
            return
        segments = f.read(head[26])
        read += 27 + len(segments)
        for n in segments:
            packet += f.read(n)
            read += n
            if n < 255:
                yield packet
                packet = b""


def _ogg(f, want="tags"):
    tags, rate, preskip, kind = {}, 0, 0, None
    for i, packet in enumerate(_ogg_packets(f)):
        if i == 0:
            if packet[:7] == b"\x01vorbis":
                kind, rate = "vorbis", struct.unpack("<I", packet[12:16])[0]
            elif packet[:8] == b"OpusHead":
                kind, rate, preskip = "opus", 48000, struct.unpack("<H", packet[10:12])[0]
            else:
                return {} if want == "tags" else None
        elif i == 1:
            body = packet[7:] if kind == "vorbis" else packet[8:]
            _vorbis_comments(body, tags, want)
            break
    if want == "cover":
        return _pick_cover(tags.get("_cover"))
    if want == "lyrics":
        return tags.get("_lyrics")
    # Its length: the last page's granule position.
    f.seek(0, 2)
    size = f.tell()
    f.seek(max(0, size - 65536))
    tail = f.read()
    at = tail.rfind(b"OggS")
    if at >= 0 and rate and at + 14 <= len(tail):
        granule = struct.unpack("<q", tail[at + 6:at + 14])[0]
        if granule > 0:
            tags["duration"] = (granule - preskip) / rate
    return tags


# --------------------------------------------------------------------- MP4

def _atoms(f, end):
    """(name, start of its data, size of its data) for each atom up to end."""
    while f.tell() + 8 <= end:
        at = f.tell()
        head = f.read(8)
        if len(head) < 8:
            return
        size, name = struct.unpack(">I", head[:4])[0], head[4:8].decode("latin1")
        hlen = 8
        if size == 1:
            size, hlen = struct.unpack(">Q", f.read(8))[0], 16
        elif size == 0:
            size = end - at
        if size < hlen or at + size > end:
            return
        yield name, at + hlen, size - hlen
        f.seek(at + size)


MP4_ITEMS = {"\xa9nam": "title", "\xa9ART": "artist", "aART": "albumArtist", "\xa9alb": "album", "\xa9day": "year",
             "\xa9gen": "genre"}


def _mp4(f, want="tags"):
    f.seek(0, 2)
    size = f.tell()
    f.seek(0)
    tags = {}
    for name, start, n in list(_atoms(f, size)):
        if name != "moov":
            continue
        f.seek(start)
        for sub, s2, n2 in list(_atoms(f, start + n)):
            if sub == "mvhd":
                f.seek(s2)
                mv = f.read(32)
                if mv[0] == 1:
                    scale, length = struct.unpack(">I", mv[20:24])[0], struct.unpack(">Q", mv[24:32])[0]
                else:
                    scale, length = struct.unpack(">I", mv[12:16])[0], struct.unpack(">I", mv[16:20])[0]
                if scale:
                    tags["duration"] = length / scale
            elif sub == "udta":
                f.seek(s2)
                for meta, s3, n3 in list(_atoms(f, s2 + n2)):
                    if meta != "meta":
                        continue
                    f.seek(s3 + 4)  # a full atom: version and flags first
                    for ilst, s4, n4 in list(_atoms(f, s3 + n3)):
                        if ilst == "ilst":
                            f.seek(s4)
                            found = _mp4_items(f, s4 + n4, tags, want)
                            if want != "tags" and found:
                                return found
        break
    return tags if want == "tags" else None


def _mp4_items(f, end, tags, want):
    for item, s, n in list(_atoms(f, end)):
        f.seek(s)
        for data, ds, dn in list(_atoms(f, s + n)):
            if data != "data":
                continue
            if item == "covr":
                tags["cover"] = True
                if want != "cover":
                    continue
                f.seek(ds)
                kind = struct.unpack(">I", f.read(4))[0] & 0xFFFFFF
                f.seek(4, 1)
                image = f.read(dn - 8)
                return (_image_mime("image/png" if kind == 14 else "image/jpeg", image), image)
            if item == "\xa9lyr":
                tags["lyrics"] = True
                if want == "lyrics":
                    f.seek(ds + 8)
                    return f.read(dn - 8).decode("utf-8", "replace")
                continue
            if want != "tags" or dn > 65536:
                continue
            f.seek(ds + 8)
            value = f.read(dn - 8)
            if item in ("trkn", "disk") and len(value) >= 6:
                tags["track" if item == "trkn" else "disc"] = str(struct.unpack(">H", value[2:4])[0])
            elif item == "gnre" and len(value) >= 2:
                n2 = struct.unpack(">H", value[:2])[0]
                if 0 < n2 <= len(GENRES):
                    tags.setdefault("genre", GENRES[n2 - 1])
            elif item in MP4_ITEMS:
                text = value.decode("utf-8", "replace")
                if MP4_ITEMS[item] == "artist":
                    tags.setdefault("artist", []).append(text)
                    tags["split"] = False
                else:
                    tags[MP4_ITEMS[item]] = text
            break
    return None


# --------------------------------------------------------------------- WAV

def _wav(f):
    f.seek(12)
    tags, rate = {}, 0
    while True:
        head = f.read(8)
        if len(head) < 8:
            break
        name, n = head[:4], struct.unpack("<I", head[4:8])[0]
        if name == b"fmt ":
            rate = struct.unpack("<I", f.read(16)[8:12])[0]  # bytes a second
            f.seek(n - 16 + (n & 1), 1)
        elif name == b"data":
            if rate:
                tags["duration"] = n / rate
            f.seek(n + (n & 1), 1)
        elif name == b"LIST":
            body = f.read(n + (n & 1))
            if body[:4] == b"INFO":
                pos = 4
                while pos + 8 <= len(body):
                    key, m = body[pos:pos + 4], struct.unpack("<I", body[pos + 4:pos + 8])[0]
                    value = body[pos + 8:pos + 8 + m].split(b"\x00")[0].decode("latin1", "replace")
                    pos += 8 + m + (m & 1)
                    name2 = {b"INAM": "title", b"IART": "artist", b"IPRD": "album", b"ICRD": "year", b"IGNR": "genre"}.get(key)
                    if name2 and value:
                        tags[name2] = value
        else:
            f.seek(n + (n & 1), 1)
    return tags
