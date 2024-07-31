---
title: "Topaz: Declarative and Verifiable Authoritative DNS at CDN-Scale"
year: 2024
location: ACM SIGCOMM 2024 Conference, Sydney NSW Australia, August 4-8, 2024.
authors:
  - james-larisch
  - tim-alberdingkthijm
  - suleman-ahmad
  - peter-wu
  - Tom Arnfeld
  - marwan-fayed
url: https://dl.acm.org/doi/10.1145/3651890.3672240
doi: 10.1145/3651890.3672240
related_interests:
  - distributed_systems
  - network_security
  - formal_verification
  - measurement
---

Today, when a CDN nameserver receives a DNS query for a customer's domain, it decides which CDN IP to return based on servicelevel objectives such as managing load or maintaining performance, but also internal needs like split testing. Many of these decisions are made a priori by assignment systems that imperatively generate maps from DNS query to IP address(es). Unfortunately, imperative assignments obfuscate nameserver behavior, especially when different objectives conflict.

In this paper we present Topaz, a new authoritative nameserver architecture for anycast CDNs which encodes DNS objectives as declarative, modular programs called policies. Nameservers execute policies directly in response to live queries. To understand or change DNS behavior, operators simply read or modify the list of policy programs. In addition, because policies are written in a formally-verified domain-specific language (topaz-lang), Topaz can detect policy conflicts before deployment. Topaz handles ~1M DNS queries per second at a global CDN, dynamically deciding addresses for millions of names on six continents. We evaluate Topaz and show that the latency overheads it introduces are acceptable.
