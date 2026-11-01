"""Whether adlerOS may run your maintenance scripts (install-maint.sh's
launcher and its sudo rule): what's installed (each script's checksum), or
the command that sets it up, as JSON for Settings → Maintenance."""
import json
import subprocess
import sys

here = sys.argv[1]  # this adlerOS's folder
installer = f"sudo {here}/agent/install-maint.sh"
try:
    done = subprocess.run(["sudo", "-n", "/usr/local/libexec/adleros/maint", "check"], stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, timeout=30, check=False)
    reply = json.loads(done.stdout) if done.returncode == 0 else {"ok": False}
except (OSError, ValueError, subprocess.TimeoutExpired):
    reply = {"ok": False}
reply["installer"] = installer
print(json.dumps(reply))
