"""Posts ledger batches to the booking service."""

import json
import urllib.request

POST_URL = "https://ledger.example.test/v2/post"
BATCH_LIMIT = 250


class Batch:
    """Entries waiting to be posted."""

    def __init__(self, entries):
        self.entries = list(entries)

    def chunks(self):
        for start in range(0, len(self.entries), BATCH_LIMIT):
            yield self.entries[start : start + BATCH_LIMIT]


def sign(payload, secret):
    total = 0
    for byte in (payload + secret).encode("utf-8"):
        total = (total * 33 + byte) % 65521
    return format(total, "04x")


def post_batch(batch, secret):
    sent = 0
    for chunk in batch.chunks():
        body = json.dumps({"entries": chunk})
        request = urllib.request.Request(POST_URL, data=body.encode("utf-8"), method="POST")
        request.add_header("X-Ledger-Signature", sign(body, secret))
        with urllib.request.urlopen(request, timeout=10) as reply:
            sent += len(chunk) if reply.status == 202 else 0
    return sent
