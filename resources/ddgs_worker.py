import json
import sys

from ddgs import DDGS


def limited_text(value, maximum):
    if not isinstance(value, str):
        return ""
    return value.strip()[:maximum]


request = json.loads(sys.stdin.read())
query = limited_text(request.get("query"), 400)
max_results = max(1, min(int(request.get("maxResults", 8)), 10))
time_range = request.get("timeRange")
time_limit = {
    "day": "d",
    "week": "w",
    "month": "m",
    "year": "y",
}.get(time_range)
region = limited_text(request.get("region"), 20) or "wt-wt"
proxy = limited_text(request.get("proxy"), 2048) or None

results = DDGS(proxy=proxy, timeout=12).text(
    query,
    region=region,
    safesearch="moderate",
    timelimit=time_limit,
    max_results=max_results,
    backend="auto",
)

normalized = []
for item in results:
    if not isinstance(item, dict):
        continue
    normalized.append(
        {
            "title": limited_text(item.get("title"), 300),
            "url": limited_text(item.get("href"), 2048),
            "snippet": limited_text(item.get("body"), 2000),
        }
    )

sys.stdout.write(json.dumps(normalized, ensure_ascii=False))
