---
title: "RFC 8586: Loop Detection in Content Delivery Networks (CDNs)"
year: 2019
location: Internet Engineering Task Force (IETF). 2019.
authors:
  - Stephen Ludin
  - Mark Nottingham
  - nick-sullivan
url: https://datatracker.ietf.org/doc/rfc8586/
related_interests:
  - measurement
  - protocols
---

This document defines the CDN-Loop request header field for HTTP. CDN-Loop addresses an operational need that occurs when an HTTP request is intentionally forwarded between Content Delivery Networks (CDNs), but is then accidentally or maliciously re-routed back into the original CDN causing a non-terminating loop. The new header field can be used to identify the error and terminate the loop.
