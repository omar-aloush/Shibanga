"""Local QA only: unavailable storage/audio and a failed observation image.

Run from the repository root, then open http://localhost:5174/ (briefing) or /#game (shared-map pilot).
The production web files are never modified. Stop with Ctrl+C.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

WEB = Path(__file__).resolve().parents[1]
FAIL_MISSION = False
ALLOW_PREVIEWS = False
FAIL_REGIONAL_STORIES = False
FAIL_REGIONAL_MAP = False

class FailureFixture(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ("/", "/index.html"):
            html = (WEB / "index.html").read_text(encoding="utf-8")
            fixture = """<script>
              Object.defineProperty(window, 'localStorage', { get() { throw new Error('QA storage unavailable'); } });
              window.AudioContext = undefined; window.webkitAudioContext = undefined;
            </script>"""
            if FAIL_REGIONAL_STORIES:
                fixture += r"""<script>const realFetch=window.fetch.bind(window);window.fetch=(url,options)=>/https:\/\/(?:en.wikipedia.org|www.wikidata.org)\//.test(String(url))?Promise.reject(new TypeError('QA regional stories offline')):realFetch(url,options);</script>"""
            payload = html.replace("<head>", "<head>" + fixture, 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif FAIL_REGIONAL_MAP and path == "/data/geography/atlas.json":
            self.send_error(503, "Intentional QA regional map failure")
        elif FAIL_MISSION and path in ("/mission.html", "/mission"):
            self.send_error(503, "Intentional QA mission failure")
        elif not ALLOW_PREVIEWS and path.startswith("/data/nisar/") and path.endswith(".webp"):
            self.send_error(404, "Intentional QA preview failure")
        else:
            super().do_GET()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5174)
    parser.add_argument("--fail-mission", action="store_true", help="Fail the mission template request to exercise retry and exit")
    parser.add_argument("--allow-previews", action="store_true", help="Allow actual previews in an isolated checkpoint fixture")
    parser.add_argument("--fail-regional-stories", action="store_true", help="Fail remote regional summaries; keep local geographic context")
    parser.add_argument("--fail-regional-map", action="store_true", help="Fail the offline atlas; preserve movement and retry")
    args = parser.parse_args()
    FAIL_MISSION = args.fail_mission
    ALLOW_PREVIEWS = args.allow_previews
    FAIL_REGIONAL_STORIES = args.fail_regional_stories
    FAIL_REGIONAL_MAP = args.fail_regional_map
    ThreadingHTTPServer(("127.0.0.1", args.port), partial(FailureFixture, directory=str(WEB))).serve_forever()
