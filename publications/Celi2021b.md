---
title: Post-quantum TLS without handshake signatures
year: 2021
location: Real World Crypto Symposium 2021. Virtual. January 2021.
authors:
  - Sofía Celi
  - armando-faz
  - Peter Schwabe
  - Douglas Stebila
  - Thom Wiggers
url: https://iacr.org/submit/files/slides/2021/rwc/rwc2021/68/slides.pdf
related_interests:
  - cryptography
---

We present KEMTLS, an alternative to the TLS 1.3 handshake that uses key-encapsulation mechanisms (KEMs) instead of signatures for server authentication. Among existing post-quantum candidates, signature schemes generally have larger public key/signature sizes compared to the public key/ciphertext sizes of KEMs: by using an IND-CCA-secure KEM for server authentication in post-quantum TLS, we obtain multiple benefits. A size-optimized post-quantum instantiation of KEMTLS requires less than half the bandwidth of a size-optimized post-quantum instantiation of TLS 1.3. In a speed-optimized instantiation, KEMTLS reduces the amount of server CPU cycles by almost 90% compared to TLS 1.3, while at the same time reducing communication size, reducing the time until the client can start sending encrypted application data, and eliminating code for signatures from the server's trusted code base.
