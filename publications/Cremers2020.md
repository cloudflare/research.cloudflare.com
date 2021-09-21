---
title: "RFC 8937: Randomness Improvements for Security Protocols"
year: 2020
location: Internet Research Task Force (IRTF). 2020.
authors:
  - Cas Cremers
  - Luke Garratt
  - Stanislav Smyshlyaev
  - nick-sullivan
  - christopher-wood
url: https://datatracker.ietf.org/doc/rfc8937/
related_areas:
  - cryptography
  - security
---

Randomness is a crucial ingredient for Transport Layer Security (TLS) and related security protocols.  Weak or predictable "cryptographically secure" pseudorandom number generators (CSPRNGs) can be abused or exploited for malicious purposes.  An initial entropy source that seeds a CSPRNG might be weak or broken as well, which can also lead to critical and systemic security problems.  This document describes a way for security protocol implementations to augment their CSPRNGs using long-term private keys.  This improves randomness from broken or otherwise subverted CSPRNGs.