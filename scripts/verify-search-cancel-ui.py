"""Compatibility wrapper for the Node Playwright regression."""

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
subprocess.run(["node", str(ROOT / "scripts" / "verify-search-cancel-ui.mjs")], cwd=ROOT, check=True)
