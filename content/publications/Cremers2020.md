---
title: "RFC 8937: Randomness Improvements for Security Protocols"
year: 2020
location: Internet Research Task Force (IRTF). 2020.
authors:
  - cas-cremers
  - luke-garratt
  - stanislav-smyshlyaev
  - nick-sullivan
  - christopher-wood
url: https://datatracker.ietf.org/doc/rfc8937/
doi: 10.17487/RFC8937
related_interests:
  - cryptography
  - security
  - protocols
pillar: safe
metaDescription: "IRTF standard describing how security protocol implementations can augment CSPRNGs using long-term private keys to improve randomness from broken or subverted pseudorandom number generators."
---

Randomness is a crucial ingredient for Transport Layer Security (TLS) and related security protocols. Weak or predictable "cryptographically secure" pseudorandom number generators (CSPRNGs) can be abused or exploited for malicious purposes. An initial entropy source that seeds a CSPRNG might be weak or broken as well, which can also lead to critical and systemic security problems. This document describes a way for security protocol implementations to augment their CSPRNGs using long-term private keys. This improves randomness from broken or otherwise subverted CSPRNGs.
