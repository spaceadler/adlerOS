#!/usr/bin/env python3
"""The adlerOS helper: runs what adlerOS asks for, from a fixed list.

adlerOS (the web app in ../app) has no Docker or root access. To change
anything it drops a request into its data/agent/queue/. systemd (the
helper's .path unit, set up by install.sh) notices and starts this script,
which runs the request's action and reports progress in
data/agent/jobs/<id>.json for adlerOS to show.

It runs as your user. An action can only be one of those in the actions
files, its parameters must each match their pattern, and commands run
without a shell, so a request can't smuggle in anything else. The few
root-only steps use sudo on root-owned copies of fixed scripts.

Two ways to run, set by the systemd unit:

    standalone   adlerOS on any Docker host: data in ../data, settings in
                 ../.env, the actions in actions.json next to this file
    homelab      HOMELAB_DIR is set: adlerOS is part of that homelab, its
                 data is in containers/core/os/data there, and the homelab's
                 own scripts/agent/actions.json adds to these actions

    python3 agent/agent.py     process the queue, then exit
"""
import json
import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path

ADLEROS = Path(__file__).resolve().parents[1]
HOMELAB = Path(os.environ["HOMELAB_DIR"]).resolve() if os.environ.get("HOMELAB_DIR") else None
if HOMELAB:
    DATA_DIR = HOMELAB / "containers/core/os/data"
    ACTION_FILES = [ADLEROS / "agent/actions.json", HOMELAB / "scripts/agent/actions.json"]
    CONFIG = HOMELAB / "homelab.env"
else:
    DATA_DIR = ADLEROS / "data"
    ACTION_FILES = [ADLEROS / "agent/actions.json"]
    CONFIG = ADLEROS / ".env"
WORKDIR = HOMELAB or ADLEROS
AGENT_DIR = Path(os.environ.get("ADLEROS_AGENT_DIR", DATA_DIR / "agent"))
QUEUE = AGENT_DIR / "queue"
JOBS = AGENT_DIR / "jobs"
ZONEINFO = Path("/usr/share/zoneinfo")

ID_PATTERN = re.compile(r"[a-f0-9]{16,64}")
MAX_REQUEST_BYTES = 64 * 1024
LOG_TAIL_LINES = 200
KEEP_JOBS = 50
STEP_TIMEOUT = 3600
MAX_RESULT_BYTES = 1024 * 1024


def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def log(message):
    print(message, flush=True)  # goes to the journal: journalctl -u adleros-agent (or homelab-agent)


# ------------------------------------------------------------- job files

def write_private(path, text, mode=0o600):
    """Write a file in place of `path`, never following a link planted there."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, path)


def rewrite(path, text):
    """Rewrite a file in place, keeping it the same file: the home screen
    sees its settings file through a bind mount of that one file, which would go
    on showing the old copy of a file that was replaced instead."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
        f.truncate()


def save_job(job):
    write_private(JOBS / f"{job['id']}.json", json.dumps(job))


def prune_jobs():
    jobs = sorted((p for p in JOBS.glob("*.json") if p.is_file()), key=lambda p: p.lstat().st_mtime)
    for old in jobs[:-KEEP_JOBS]:
        old.unlink(missing_ok=True)
        old.with_suffix(".log").unlink(missing_ok=True)


# --------------------------------------------------------------- requests

def read_request(path):
    # The queue is writable by the home screen: only plain, small files that
    # belong to us, and never through a link.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as f:
        info = os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("not a regular file of ours")
        data = f.read(MAX_REQUEST_BYTES + 1)
    if len(data) > MAX_REQUEST_BYTES:
        raise ValueError("request too large")
    request = json.loads(data)
    if not isinstance(request, dict):
        raise ValueError("request is not an object")
    return request


def load_actions():
    """Every action from the actions files; the first file to name one wins."""
    merged = {}
    for path in ACTION_FILES:
        if not path.is_file():
            continue
        for name, spec in json.loads(path.read_text()).items():
            if not name.startswith("_") and isinstance(spec, dict):
                merged.setdefault(name, spec)
    return merged


def validate_params(spec, params):
    """The request's parameters, each checked against the action's rules."""
    rules = spec.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    unknown = set(params) - set(rules)
    if unknown:
        raise ValueError(f"unknown parameter(s): {', '.join(sorted(unknown))}")
    clean = {}
    for name, rule in rules.items():
        if name not in params:
            if rule.get("optional"):
                continue
            raise ValueError(f"missing parameter {name}")
        value = params[name]
        if (not isinstance(value, str) or len(value) > rule.get("maxLength", 256)
                or not re.fullmatch(rule["pattern"], value)):
            raise ValueError(f"invalid value for {name}")
        if rule.get("check") == "timezone" and not (ZONEINFO / value).is_file():
            raise ValueError(f"unknown timezone {value}")
        clean[name] = value
    return clean


# ------------------------------------------------------------------ steps

def set_config(keys, params):
    """Write params into the settings file (homelab.env, or .env when
    standalone), replacing a key's line or appending it."""
    lines = CONFIG.read_text().splitlines() if CONFIG.exists() else []
    for key in keys:
        if key not in params:
            continue
        line = f"{key}={params[key]}"
        for i, existing in enumerate(lines):
            if existing.startswith(f"{key}="):
                lines[i] = line
                break
        else:
            lines.append(line)
    rewrite(CONFIG, "\n".join(lines) + "\n")


def expand(argv, params):
    out = []
    for arg in argv:
        match = re.fullmatch(r"\{param:([A-Za-z_][A-Za-z0-9_]*)\}", arg)
        if match:
            out.append(params[match.group(1)])
        else:
            arg = arg.replace("{adleros}", str(ADLEROS))
            if "{homelab}" in arg:
                if not HOMELAB:
                    raise ValueError("this action needs a homelab (HOMELAB_DIR)")
                arg = arg.replace("{homelab}", str(HOMELAB))
            out.append(arg)
    return out


def run(argv, job, logfile):
    """Run a command, streaming its output into the job as it goes."""
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "HOMELAB_DIR")}
    env.setdefault("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
    proc = subprocess.Popen(argv, cwd=WORKDIR, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    deadline = time.monotonic() + STEP_TIMEOUT
    last_save = 0.0
    for line in proc.stdout:
        line = line.rstrip("\n")
        logfile.write(line + "\n")
        job["log"].append(line)
        del job["log"][:-LOG_TAIL_LINES]
        if time.monotonic() - last_save > 0.5:
            logfile.flush()
            save_job(job)
            last_save = time.monotonic()
        if time.monotonic() > deadline:
            proc.kill()
            job["log"].append(f"(stopped after {STEP_TIMEOUT}s)")
            break
    return proc.wait()


def run_for_result(argv, job, logfile):
    """Run a command whose output is JSON for the page: it becomes the job's
    result; anything it says on stderr goes to the log."""
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "HOMELAB_DIR")}
    env.setdefault("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
    proc = subprocess.run(argv, cwd=WORKDIR, env=env, stdin=subprocess.DEVNULL, capture_output=True,
                          text=True, errors="replace", timeout=STEP_TIMEOUT, check=False)
    for line in proc.stderr.splitlines():
        logfile.write(line + "\n")
        job["log"].append(line)
    del job["log"][:-LOG_TAIL_LINES]
    if len(proc.stdout) > MAX_RESULT_BYTES:
        raise ValueError("result too large")
    job["result"] = json.loads(proc.stdout) if proc.stdout.strip() else None
    return proc.returncode


# ---------------------------------------------------------------- process

def process(path, actions):
    job_id = path.stem
    try:
        request = read_request(path)
    except (OSError, ValueError) as e:
        log(f"skipping {path.name}: {e}")
        return
    finally:
        path.unlink(missing_ok=True)  # never retry a request that crashed us
    if not ID_PATTERN.fullmatch(job_id) or request.get("id") != job_id:
        log(f"skipping {path.name}: bad id")
        return

    name = request.get("action")
    spec = actions.get(name) if isinstance(name, str) else None
    job = {"id": job_id, "action": name, "label": (spec or {}).get("label", str(name)),
           "status": "running", "requested": request.get("requested"), "started": stamp(),
           "finished": None, "exitCode": None, "error": None, "log": []}
    try:
        if not spec:
            raise ValueError(f"unknown action {name!r}")
        if spec.get("mode") and spec["mode"] != ("homelab" if HOMELAB else "standalone"):
            raise ValueError(f"{name} is only for {spec['mode']} installs")
        params = validate_params(spec, request.get("params"))
        job["params"] = params
    except ValueError as e:
        job.update(status="failed", error=str(e), finished=stamp())
        save_job(job)
        log(f"{job_id}: rejected: {e}")
        return

    # Quiet actions (status checks) run often: the journal hears only of failures.
    quiet = bool(spec.get("quiet"))
    if not quiet:
        log(f"{job_id}: {name} {params}")
    if spec.get("finalBeforeRun"):
        # Restart and shut down take this machine with them: report first.
        job.update(status="done", finished=stamp())
    save_job(job)
    with open(JOBS / f"{job_id}.log", "w") as logfile:
        for step in spec.get("steps", []):
            try:
                if "set-config" in step:
                    set_config(step["set-config"], params)
                    job["log"].append(f"Saved {', '.join(k for k in step['set-config'] if k in params) or 'nothing'} to {CONFIG.name}")
                    continue
                argv = expand(step["run"], params)
                if step.get("result"):
                    code = run_for_result(argv, job, logfile)
                else:
                    job["log"].append(f"$ {' '.join(argv)}")
                    code = run(argv, job, logfile)
            except (OSError, KeyError, ValueError, subprocess.TimeoutExpired) as e:
                job.update(status="failed", error=str(e), finished=stamp())
                save_job(job)
                log(f"{job_id}: failed: {e}")
                return
            if code != 0:
                job.update(status="failed", exitCode=code, error=f"{argv[0]} exited with {code}", finished=stamp())
                save_job(job)
                log(f"{job_id}: failed with exit code {code}")
                return
    job.update(status="done", exitCode=0, finished=stamp())
    save_job(job)
    if not quiet:
        log(f"{job_id}: done")


def main():
    if os.geteuid() == 0:
        sys.exit("the adlerOS helper runs as your user, not root (see its systemd unit)")
    QUEUE.mkdir(parents=True, exist_ok=True)
    JOBS.mkdir(parents=True, exist_ok=True)
    actions = load_actions()
    # Keep going until the queue is empty: requests can arrive while one runs.
    while True:
        pending = sorted((p for p in QUEUE.glob("*.json") if not p.name.startswith(".")),
                         key=lambda p: p.lstat().st_mtime)
        if not pending:
            break
        process(pending[0], actions)
    prune_jobs()


if __name__ == "__main__":
    main()
