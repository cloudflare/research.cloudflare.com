---
title: "Round-optimal verifiable oblivious pseudorandom functions from ideal lattices"
year: 2021
location: IACR International Conference on Public-Key Cryptography, pp. 261-289. Springer, Cham, 2021.
authors:
  - Martin Albrecht
  - Alex Davidson
  - Amit Deo
  - Nigel P. Smart
url: https://eprint.iacr.org/2019/1271.pdf
doi: 10.1007/978-3-030-75248-4_10
related_interests:
  - cryptography
---

Verifiable Oblivious Pseudorandom Functions (VOPRFs) are protocols that allow a client to learn verifiable pseudorandom function (PRF) evaluations on inputs of their choice. The PRF evaluations are computed by a server using their own secret key. The security of the protocol prevents both the server from learning anything about the client’s input, and likewise the client from learning anything about the server’s key. VOPRFs have many applications including password-based authentication, secret-sharing, anonymous authentication and efficient private set intersection. In this work, we construct the first round-optimal (online) VOPRF protocol that retains security from well-known subexponential lattice hardness assumptions. Our protocol requires constructions of non-interactive zero-knowledge arguments of knowledge (NIZKAoK). Using recent developments in the area of post-quantum zero-knowledge arguments of knowledge, we show that our VOPRF may be securely instantiated in the quantum random oracle model. We construct such arguments as extensions of prior work in the area of lattice-based zeroknowledge proof systems.
