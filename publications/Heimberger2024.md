---
title: "Private SCT Auditing, Revisted"
year: 2024
location: Transparency.dev Summit. October 9-11, 2024.
authors:
  - lena-heimberger
  - chris-patton
  - bas-westerbaan
url: https://eprint.iacr.org/2025/556
related_interests:
  - security
---

We revisit the problem of SCT auditing given recent changes in the Certificate Transparency (CT) ecosystem and improvements in private information retrieval (PIR).

In order for a client to securely connect to a server on the web, the client must trust certificate authorities (CAs) only to issue certificates to the legitimate operator of the server. If a certificate is miss-issued, it is possible for an attacker to impersonate the server to the client. The goal of Certificate Transparency (CT) is to log every certificate issued in a manner that allows anyone to audit the logs for miss-issuance. A client can even audit a CT log itself, but this would leak sensitive browsing data to the log operator. As a result, client-side audits are rare in practice. In this work, we revisit private CT auditing from a real-world perspective. Our study is motivated by recent changes to the CT ecosystem and advancements in Private Information Retrieval (PIR). First, we find that checking for inclusion of Signed Certificate Timestamps (SCTs) in a log — the audit performed by clients — is now possible with PIR in under a second and under 100kb of communication with minor adjustments to the protocol that have been proposed previously. Our results also show how to scale audits by using existing batching techniques and the algebraic structure of the PIR protocols, in particular to obtain certificate hashes by included in the log. Since PIR protocols are more performant with smaller databases, we also suggest a number of strategies to lower the size of the SCT database for audits. Our key observation is that the web will likely transition to a new model for certificate issuance. While this transition is primarily motivated by the need to adapt the PKI to larger, post-quantum signature schemes, it also removes the need for SCT audits in most cases. We present the first estimates of how this transition may impact SCT auditing, based on data gathered from public CT logs. We find that large scale deployment of the new issuance model may reduce the number of SCT audits needed by a factor of 1,000, making PIR-based auditing practical to deploy.
