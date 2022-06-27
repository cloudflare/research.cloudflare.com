---
title: "nQUIC: Noise-based QUIC packet protection"
year: 2018
location: "EPIQ'18: Proceedings of the Workshop on the Evolution, Performance, and Interoperability of QUIC, pp. 22-28. 2018."
authors:
  - Mathias Hall-Andersen
  - David Wong
  - nick-sullivan
  - alishah-chator
url: https://eprint.iacr.org/2019/028.pdf
doi: 10.1145/3284850.3284854
related_interests:
  - security
  - cryptography
---

We present nQUIC, a variant of QUIC-TLS that uses the Noise protocol framework for its key exchange and basis of its packet protector with no semantic transport changes. nQUIC is designed for deployment in systems and for applications that assert trust in raw public keys rather than PKI-based certificate chains. It uses a fixed key exchange algorithm, compromising agility for implementation and verification ease. nQUIC provides mandatory server and optional client authentication, resistance to Key Compromise Impersonation attacks, and forward and future secrecy of traffic key derivation, which makes it favorable to QUIC-TLS for long-lived QUIC connections in comparable applications. We developed two interoperable prototype implementations written in Go and Rust. Experimental results show that nQUIC finishes its handshake in a comparable amount of time as QUIC-TLS.
