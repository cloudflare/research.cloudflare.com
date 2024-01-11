---
title: "RFC 9497: Oblivious Pseudorandom Functions (OPRFs) Using Prime-Order Groups"
year: 2023
location: Internet Research Task Force (IRTF). 2023.
authors:
  - alex-davidson
  - armando-faz
  - nick-sullivan
  - christopher-wood
url: https://datatracker.ietf.org/doc/rfc9497/
related_interests:
  - cryptography
  - protocols
---

An Oblivious Pseudorandom Function (OPRF) is a two-party protocol between a client and a server for computing the output of a Pseudorandom Function (PRF). The server provides the PRF private key, and the client provides the PRF input. At the end of the protocol, the client learns the PRF output without learning anything about the PRF private key, and the server learns neither the PRF input nor output.

An OPRF can also satisfy a notion of 'verifiability', called a VOPRF. A VOPRF ensures clients can verify that the server used a specific private key during the execution of the protocol.

A VOPRF can also be partially oblivious, called a POPRF. A POPRF allows clients and servers to provide public input to the PRF computation.

This document specifies an OPRF, VOPRF, and POPRF instantiated within standard prime-order groups, including elliptic curves.

This document is a product of the Crypto Forum Research Group (CFRG) in the IRTF.
