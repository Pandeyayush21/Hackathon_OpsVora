"""Builds the hosted-preview version of index.html: no document wrapper, no manifest or service worker.
Usage: python3 scripts/build-artifact.py OUT.html"""
import re, sys, pathlib
src = (pathlib.Path(__file__).parent.parent / "index.html").read_text()
head = re.search(r"<head>(.*?)</head>", src, re.S).group(1)
body = re.search(r"<body[^>]*>(.*)</body>", src, re.S).group(1)
head = "\n".join(l for l in head.splitlines()
                 if "data-pwa" not in l and 'charset=' not in l and 'name="viewport"' not in l and 'theme-color' not in l)
out = head.strip() + "\n" + body.replace('<script>', '<script>document.body.dataset.world = "0";', 1)
pathlib.Path(sys.argv[1]).write_text(out)
print("wrote", sys.argv[1], len(out), "bytes")
