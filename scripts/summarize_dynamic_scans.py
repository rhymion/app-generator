#!/usr/bin/env python3
"""Print a Markdown summary of the Dynamic Scans results (for $GITHUB_STEP_SUMMARY).

Usage: python3 scripts/summarize_dynamic_scans.py <results-dir>

Reads whatever the scans left in the directory; a missing file is reported as
"no result" instead of failing, because the scans are report-only.
"""

import collections
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET


def zap_counts(path: pathlib.Path):
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    counts = collections.Counter()
    for site in data.get("site", []):
        for alert in site.get("alerts", []):
            counts[re.sub(r" \(.*", "", alert.get("riskdesc", "Unknown"))] += 1
    return counts


def schemathesis_counts(directory: pathlib.Path):
    files = sorted(directory.glob("*.xml")) if directory.exists() else []
    if not files:
        return None
    counts = collections.Counter()
    for report in files:
        for case in ET.parse(report).getroot().iter("testcase"):
            for tag in ("failure", "error"):
                for node in case.findall(tag):
                    # ST101 = server error; ST103 (undocumented status code) and
                    # ST108 (response violates schema) = schema violation.
                    codes = set(re.findall(r"ST\d+", node.get("message", "")))
                    if "ST101" in codes:
                        counts["server error"] += 1
                    if codes & {"ST103", "ST108"}:
                        counts["schema violation"] += 1
                    if not codes & {"ST101", "ST103", "ST108"}:
                        counts["other"] += 1
    return counts


def main() -> int:
    root = pathlib.Path(sys.argv[1])
    print("### Dynamic scans (report-only except Nuclei)")
    for label, name in (("ZAP baseline", "zap-baseline.json"), ("ZAP API scan", "zap-api.json")):
        counts = zap_counts(root / name)
        if counts is None:
            print(f"- {label}: no result")
        else:
            detail = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) or "no alerts"
            print(f"- {label}: {detail}")
    counts = schemathesis_counts(root / "schemathesis")
    if counts is None:
        print("- Schemathesis: no result")
    else:
        detail = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) or "no failures"
        print(f"- Schemathesis: {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
