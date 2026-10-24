"""iCalendar (RFC 5545), for adlerOS's Calendar: a calendar's events, read,
and their repeats worked out between two days. What calendar apps send:
time zones by name (or only by their offsets, as Outlook's are), all-day and
floating times, RRULE (daily, weekly, monthly, yearly; BYDAY, BYMONTHDAY,
BYMONTH, BYSETPOS, COUNT, UNTIL, INTERVAL, WKST), EXDATE, RDATE, and single
occurrences moved, changed or cancelled (RECURRENCE-ID). Not BYWEEKNO,
BYYEARDAY or hourly repeats: an event with one shows once, at its start.
"""
import datetime as dt
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = dt.timezone.utc
DAY = dt.timedelta(days=1)
WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
MAX_PERIODS = 20000  # a repeat's periods looked at, at most, for one range


# ------------------------------------------------------------ reading

def parse(text):
    """A VCALENDAR (or several, one after another) as nested components:
    {"name", "props": [(NAME, {PARAM: value}, value)], "children"}."""
    root = {"name": "", "props": [], "children": []}
    stack = [root]
    for line in re.sub(r"\r?\n[ \t]", "", text).splitlines():
        if not line.strip():
            continue
        name, params, value = parse_line(line)
        if name == "BEGIN":
            comp = {"name": value.upper(), "props": [], "children": []}
            stack[-1]["children"].append(comp)
            stack.append(comp)
        elif name == "END":
            if len(stack) > 1:
                stack.pop()
        else:
            stack[-1]["props"].append((name, params, value))
    return root["children"]


def parse_line(line):
    """NAME;PARAM=a,"b:c";OTHER=d:value -> ("NAME", {"PARAM": "a,b:c", ...}, "value")."""
    i, n = 0, len(line)
    while i < n and line[i] not in ";:":
        i += 1
    name, params = line[:i].upper(), {}
    while i < n and line[i] == ";":
        j = i + 1
        while j < n and line[j] not in "=;:":
            j += 1
        key, value, i = line[i + 1:j].upper(), "", j
        if i < n and line[i] == "=":
            i += 1
            parts = []
            while i < n and line[i] not in ";:":
                if line[i] == '"':
                    k = line.find('"', i + 1)
                    k = n if k < 0 else k
                    parts.append(line[i + 1:k])
                    i = k + 1
                else:
                    k = i
                    while k < n and line[k] not in ';:"':
                        k += 1
                    parts.append(line[i:k])
                    i = k
            value = "".join(parts)
        params[key] = value
    return name, params, line[i + 1:] if i < n else ""


def text(value):
    """A TEXT value, its escapes undone."""
    return re.sub(r"\\([nN,;\\])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), value)


def prop(comp, name):
    """(params, value) of a component's first NAME, or ({}, None)."""
    for k, params, value in comp["props"]:
        if k == name:
            return params, value
    return {}, None


def props(comp, name):
    return [(params, value) for k, params, value in comp["props"] if k == name]


# --------------------------------------------------------- time zones

def zones(calendar):
    """Its VTIMEZONEs' TZIDs, each a zoneinfo zone (by its name, or the place
    it names), else a fixed offset (its standard time's, latest first)."""
    out = {}
    for tz in (c for c in calendar["children"] if c["name"] == "VTIMEZONE"):
        tzid = prop(tz, "TZID")[1]
        if not tzid:
            continue
        zone = named_zone(tzid) or named_zone(prop(tz, "X-LIC-LOCATION")[1] or "")
        if not zone:
            parts = sorted(((prop(p, "DTSTART")[1] or "", prop(p, "TZOFFSETTO")[1] or "") for p in tz["children"]
                            if p["name"] == "STANDARD"), reverse=True) or \
                sorted(((prop(p, "DTSTART")[1] or "", prop(p, "TZOFFSETTO")[1] or "") for p in tz["children"]), reverse=True)
            offset = parts and re.fullmatch(r"([+-])(\d\d)(\d\d)(\d\d)?", parts[0][1])
            if offset:
                sign = -1 if offset.group(1) == "-" else 1
                zone = dt.timezone(sign * dt.timedelta(hours=int(offset.group(2)), minutes=int(offset.group(3))), tzid[:40])
        if zone:
            out[tzid] = zone
    return out


def named_zone(name):
    """zoneinfo's zone for a name, also one with a prefix
    (/mozilla.org/20050126_1/Europe/Zurich), or None."""
    name = name.strip().strip('"')
    tries = [name] + ["/".join(name.split("/")[-k:]) for k in (3, 2) if name.count("/") >= k]
    for t in tries:
        try:
            return ZoneInfo(t) if t else None
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return None


# ------------------------------------------------------------- values

def value_of(params, value, tzs):
    """A DATE or DATE-TIME: a date, a naive datetime (floating: the viewer's
    time) or an aware one. None if it isn't one."""
    value = (value or "").strip().split(",")[0].split("/")[0]  # a list or a PERIOD: its first start
    m = re.fullmatch(r"(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?", value)
    if not m:
        return None
    y, mo, d, h, mi, s, z = m.groups()
    try:
        if h is None or params.get("VALUE", "").upper() == "DATE":
            return dt.date(int(y), int(mo), int(d))
        when = dt.datetime(int(y), int(mo), int(d), int(h), int(mi), int(s or 0))
    except ValueError:
        return None
    if z:
        return when.replace(tzinfo=UTC)
    tzid = params.get("TZID")
    zone = tzs.get(tzid) or named_zone(tzid) if tzid else None
    return when.replace(tzinfo=zone) if zone else when


def values_of(params, value, tzs):
    """Every one of a list (EXDATE:a,b,c)."""
    return [v for v in (value_of(params, part, tzs) for part in (value or "").split(",")) if v is not None]


def duration(value):
    """ISO 8601's P1DT2H…, as a timedelta (None if it isn't one)."""
    m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", (value or "").strip())
    if not m or not any(m.groups()[1:]):
        return None
    w, d, h, mi, s = (int(x or 0) for x in m.groups()[1:])
    span = dt.timedelta(weeks=w, days=d, hours=h, minutes=mi, seconds=s)
    return -span if m.group(1) == "-" else span


def local(value, zone):
    """A start as the event's own wall clock: a date stays one; an aware
    time is put in zone and made naive (zone None: it's floating)."""
    if isinstance(value, dt.datetime) and value.tzinfo is not None and zone is not None:
        return value.astimezone(zone).replace(tzinfo=None)
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=None)
    return value


# ------------------------------------------------------------- events

def events(calendar):
    """A VCALENDAR's VEVENTs, read: [{uid, start, end, allDay, zone, …}]."""
    tzs = zones(calendar)
    out = []
    for c in calendar["children"]:
        if c["name"] != "VEVENT":
            continue
        start = value_of(*prop(c, "DTSTART"), tzs)
        if start is None:
            continue
        all_day = not isinstance(start, dt.datetime)
        zone = start.tzinfo if not all_day else None
        end = value_of(*prop(c, "DTEND"), tzs)
        span = None
        if end is not None and type(end) is type(start):
            span = local(end, zone) - local(start, zone)
        elif prop(c, "DURATION")[1]:
            span = duration(prop(c, "DURATION")[1])
        if span is None or span < dt.timedelta(0):
            span = DAY if all_day else dt.timedelta(0)
        if all_day and span < DAY:
            span = DAY
        rid = value_of(*prop(c, "RECURRENCE-ID"), tzs)
        out.append({
            "uid": prop(c, "UID")[1] or "", "start": local(start, zone), "span": span, "allDay": all_day, "zone": zone,
            "title": text(prop(c, "SUMMARY")[1] or ""), "location": text(prop(c, "LOCATION")[1] or ""),
            "description": text(prop(c, "DESCRIPTION")[1] or ""), "url": (prop(c, "URL")[1] or "").strip(),
            "status": (prop(c, "STATUS")[1] or "").upper(), "transparent": (prop(c, "TRANSP")[1] or "").upper() == "TRANSPARENT",
            "color": (prop(c, "COLOR")[1] or "").strip(),
            "rrule": prop(c, "RRULE")[1],
            "exdates": [x for p, v in props(c, "EXDATE") for x in values_of(p, v, tzs)],
            "rdates": [x for p, v in props(c, "RDATE") for x in values_of(p, v, tzs)],
            "recurrenceId": local(rid, zone) if rid is not None else None,
        })
    return out


def rrule(value):
    """RRULE's parts, or None for one this doesn't repeat."""
    parts = {}
    for part in (value or "").split(";"):
        k, _, v = part.partition("=")
        parts[k.strip().upper()] = v.strip().upper()
    freq = parts.get("FREQ")
    if freq not in ("DAILY", "WEEKLY", "MONTHLY", "YEARLY") or "BYWEEKNO" in parts or "BYYEARDAY" in parts:
        return None
    ints = lambda key: [int(x) for x in parts.get(key, "").split(",") if re.fullmatch(r"[+-]?\d+", x)]
    byday = []
    for x in parts.get("BYDAY", "").split(","):
        m = re.fullmatch(r"([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)", x)
        if m:
            byday.append((int(m.group(1) or 0), WEEKDAYS[m.group(2)]))
    count = parts.get("COUNT", "")
    return {"freq": freq, "interval": max(1, int(parts["INTERVAL"])) if parts.get("INTERVAL", "").isdigit() else 1,
            "count": int(count) if count.isdigit() else None, "until": parts.get("UNTIL"),
            "byday": byday, "bymonthday": [d for d in ints("BYMONTHDAY") if d and -31 <= d <= 31],
            "bymonth": [m for m in ints("BYMONTH") if 1 <= m <= 12], "bysetpos": [p for p in ints("BYSETPOS") if p],
            "wkst": WEEKDAYS.get(parts.get("WKST", "MO"), 0)}


def month_days(y, m):
    first = dt.date(y, m, 1)
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return [first + dt.timedelta(i) for i in range((nxt - first).days)]


def nth(days, byday):
    """The days among these that BYDAY picks: every Monday (MO), the second
    Tuesday (2TU), the last Friday (-1FR)."""
    out = set()
    for n, wd in byday:
        same = [d for d in days if d.weekday() == wd]
        if n == 0:
            out.update(same)
        elif -len(same) <= n <= len(same) and n:
            out.add(same[n - 1] if n > 0 else same[n])
    return out


def period(rule, start, k):
    """The kth period's days (k periods of INTERVAL after the start's), in
    order, BYSETPOS applied; and the period's first day."""
    f, iv = rule["freq"], rule["interval"]
    byday, bymd, bymonth = rule["byday"], rule["bymonthday"], rule["bymonth"]
    if f == "DAILY":
        first = start + dt.timedelta(days=k * iv)
        days = [first]
        if bymonth:
            days = [d for d in days if d.month in bymonth]
        if bymd:
            days = [d for d in days if day_in(d, bymd)]
        if byday:
            days = [d for d in days if d.weekday() in {wd for _, wd in byday}]
    elif f == "WEEKLY":
        first = start - dt.timedelta(days=(start.weekday() - rule["wkst"]) % 7) + dt.timedelta(weeks=k * iv)
        week = [first + dt.timedelta(i) for i in range(7)]
        wds = {wd for _, wd in byday} or {start.weekday()}
        days = [d for d in week if d.weekday() in wds and (not bymonth or d.month in bymonth)]
    elif f == "MONTHLY":
        months = start.month - 1 + k * iv
        y, m = start.year + months // 12, months % 12 + 1
        first = dt.date(y, m, 1)
        all_days = month_days(y, m)
        if bymonth and m not in bymonth:
            days = []
        elif bymd:
            days = [d for d in all_days if day_in(d, bymd)]
            if byday:
                days = [d for d in days if d.weekday() in {wd for _, wd in byday}]
        elif byday:
            days = sorted(nth(all_days, byday))
        else:
            days = [d for d in all_days if d.day == start.day]
    else:  # YEARLY
        y = start.year + k * iv
        first = dt.date(y, 1, 1)
        if bymonth:
            days = []
            for m in sorted(set(bymonth)):
                md = month_days(y, m)
                if bymd:
                    pick = [d for d in md if day_in(d, bymd)]
                    if byday:
                        pick = [d for d in pick if d.weekday() in {wd for _, wd in byday}]
                elif byday:
                    pick = sorted(nth(md, byday))
                else:
                    pick = [d for d in md if d.day == start.day]
                days += pick
        elif bymd:
            days = [d for m in range(1, 13) for d in month_days(y, m) if day_in(d, bymd)]
        elif byday:
            days = sorted(nth([d for m in range(1, 13) for d in month_days(y, m)], byday))
        else:
            days = [d for d in month_days(y, start.month) if d.day == start.day]
    if rule["bysetpos"] and days:
        days = sorted({days[p - 1] if p > 0 else days[p] for p in rule["bysetpos"] if -len(days) <= p <= len(days)})
    return days, first


def day_in(d, bymonthday):
    last = month_days(d.year, d.month)[-1].day
    return any(d.day == (md if md > 0 else last + md + 1) for md in bymonthday)


def periods_before(rule, start, day):
    """How many whole periods lie between start and day (to skip them)."""
    f, iv = rule["freq"], rule["interval"]
    if f == "DAILY":
        n = (day - start).days
    elif f == "WEEKLY":
        n = (day - start).days // 7
    elif f == "MONTHLY":
        n = (day.year - start.year) * 12 + day.month - start.month
    else:
        n = day.year - start.year
    return max(0, n // iv - 1)


def starts(ev, rule, until, lo, hi):
    """An event's starts (its own wall clock) from its first through hi: the
    first always, then its rule's, by COUNT and UNTIL. lo: one before this
    can't reach the range (the periods before it are skipped, unless there's
    a COUNT to keep)."""
    first = ev["start"]
    day0 = first if not isinstance(first, dt.datetime) else first.date()
    clock = first.time() if isinstance(first, dt.datetime) else None
    yield first
    if rule is None:
        return
    made, k = 1, 0
    if rule["count"] is None and lo is not None:
        k = periods_before(rule, day0, lo)
    for _ in range(MAX_PERIODS):
        days, period_first = period(rule, day0, k)
        k += 1
        if period_first > hi:
            return
        for d in days:
            when = dt.datetime.combine(d, clock) if clock is not None else d
            if when <= first:
                continue
            if until is not None and when > until:
                return
            if when > (hi if clock is None else dt.datetime.combine(hi, dt.time.max)):
                return
            yield when
            made += 1
            if rule["count"] is not None and made >= rule["count"]:
                return


def until_of(ev, value):
    """UNTIL as the event's wall clock (a date for an all-day event)."""
    if not value:
        return None
    when = value_of({}, value, {})
    if when is None:
        return None
    if not ev["allDay"]:
        if not isinstance(when, dt.datetime):
            return dt.datetime.combine(when, dt.time.max)
        return local(when, ev["zone"]) if when.tzinfo else when
    return when.date() if isinstance(when, dt.datetime) else when


def instant(value, zone, viewer):
    """A wall-clock start as an aware time (a floating one in the viewer's zone)."""
    return value.replace(tzinfo=zone or viewer)


def expand(evs, first_day, last_day, viewer):
    """Every occurrence of these events (one UID's master and its moved or
    changed ones, or several UIDs) on first_day…last_day in the viewer's
    zone: [{uid, start, end, allDay, original, repeats, …}], start and end
    aware (or dates, end the day after, for an all-day one)."""
    lo = dt.datetime.combine(first_day, dt.time.min, viewer)
    hi = dt.datetime.combine(last_day + DAY, dt.time.min, viewer)
    by_uid = {}
    for ev in evs:
        by_uid.setdefault(ev["uid"], []).append(ev)
    out = []
    for uid, group in by_uid.items():
        masters = [e for e in group if e["recurrenceId"] is None]
        changed = {e["recurrenceId"]: e for e in group if e["recurrenceId"] is not None}
        for master in masters[:1]:
            rule = rrule(master["rrule"])
            ex = set(master["exdates"])
            zone = master["zone"]
            ex = {local(x, zone) for x in ex}
            ex_days = {x for x in ex if not isinstance(x, dt.datetime)}
            span = master["span"]
            # Wall-clock bounds a little wide (zones differ by under a day).
            wlo, whi = first_day - span - 2 * DAY, last_day + 2 * DAY
            seen = set()
            extra = sorted({local(r, zone) for r in master["rdates"]}, key=sort_key)
            for when in [*starts(master, rule, until_of(master, rule and rule["until"]), wlo, whi), *extra]:
                if when in seen:
                    continue
                seen.add(when)
                if when in ex or (isinstance(when, dt.datetime) and when.date() in ex_days):
                    continue
                if when in changed:
                    continue  # its changed one stands in for it, below
                add_occurrence(out, master, when, when, span, zone, viewer, lo, hi, rule is not None or bool(extra))
        for rid, ev in changed.items():
            if ev["status"] == "CANCELLED":
                continue
            add_occurrence(out, ev, rid, ev["start"], ev["span"], ev["zone"], viewer, lo, hi, True)
    out.sort(key=lambda o: (o["sortStart"], not o["allDay"], o["title"].lower()))
    for o in out:
        o.pop("sortStart")
    return out


def sort_key(v):
    return v if isinstance(v, dt.datetime) else dt.datetime.combine(v, dt.time.min)


def add_occurrence(out, ev, original, when, span, zone, viewer, lo, hi, repeats):
    if ev["allDay"] or not isinstance(when, dt.datetime):
        day = when if not isinstance(when, dt.datetime) else when.date()
        end = day + max(span, DAY)
        s, e = dt.datetime.combine(day, dt.time.min, viewer), dt.datetime.combine(end, dt.time.min, viewer)
        if not (s < hi and e > lo):
            return
        start_out, end_out, all_day = day.isoformat(), end.isoformat(), True
    else:
        s = instant(when, zone, viewer)
        e = instant(when + span, zone, viewer)
        if not (s < hi and (e > lo or (e == s and s >= lo))):
            return
        start_out, end_out, all_day = iso(s), iso(e), False
    out.append({
        "uid": ev["uid"], "id": f"{ev['uid']}|{original.isoformat() if original is not None else ''}",
        "title": ev["title"], "start": start_out, "end": end_out, "allDay": all_day,
        "location": ev["location"], "description": ev["description"], "url": ev["url"],
        "status": ev["status"], "transparent": ev["transparent"], "color": ev["color"], "repeats": repeats,
        "zone": getattr(zone, "key", None) or (str(zone) if zone else None), "sortStart": s,
    })


def iso(when):
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
