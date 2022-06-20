---
title: Secure Time
related_profiles:
  - christopher-patton
  - tanya-verma
  - wesley-evans
#related_areas:
#  - cryptography
resources:
  - text: "Roughtime: Securing Time with Digital Signatures"
    blog: https://blog.cloudflare.com/roughtime/
  - text: "Announcing cfnts: Cloudflare's implementation of NTS in Rust"
    blog: https://blog.cloudflare.com/announcing-cfnts/
  - text: NTS is now an RFC
    blog: https://blog.cloudflare.com/nts-is-now-rfc/
  - text: Introducing time.cloudflare.com
    blog: https://blog.cloudflare.com/secure-time/
  - text: Cloudflare's implementation of the NTS protocol written in Rust
    link: https://github.com/cloudflare/cfnts
  - text: Cloudflare Time Services
    link: https://www.cloudflare.com/en-gb/time/
---

<img src="https://blog.cloudflare.com/content/images/2019/06/time-service@3x-1.png" alt="Secure Time" width="200" align="right" />

NTP is the most commonly used protocol for time synchronization on the Internet. If an attacker can leverage vulnerabilities in NTP to manipulate time on computer clocks, they can undermine the security guarantees provided by these systems. 

We are exploring ways to add security guarantees to the time infrastructure of the Internet.