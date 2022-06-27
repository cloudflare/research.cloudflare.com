---
title: "The Ties that un-Bind: Decoupling IP from web services and sockets for robust addressing agility at CDN-scale"
year: 2021
location: Proceedings of the 2021 ACM SIGCOMM 2021 Conference, pp. 433–446. 2021.
authors:
  - marwan-fayed
  - Lorenz Bauer
  - Vasilis Giotsas
  - Sami Kerola
  - Marek Majkowski
  - Pavel Odinstov
  - Jakub Sitnicki
  - Taejoong Chung
  - Dave Levin
  - Alan Mislove
  - christopher-wood
  - nick-sullivan
url: https://dl.acm.org/doi/pdf/10.1145/3452296.3472922
doi: 10.1145/3452296.3472922
related_interests:
  - security
  - measurement
---

The couplings between IP addresses, names of content or services, and socket interfaces, are too tight. This impedes system manageability, growth, and overall provisioning. In turn, large-scale content providers are forced to use staggering numbers of addresses, ultimately leading to address exhaustion (IPv4) and inefficiency (IPv6).

In this paper, we revisit IP bindings, entirely. We attempt to evolve addressing conventions by decoupling IP in DNS and from network sockets. Alongside technologies such as SNI and ECMP, a new architecture emerges that "unbinds" IP from services and servers, thereby returning IP's role to merely that of reachability. The architecture is under evaluation at a major CDN in multiple datacenters. We show that addresses can be generated randomly per-query, for 20M+ domains and services, from as few as ~4K addresses, 256 addresses, and even one IP address. We explain why this approach is transparent to routing, L4/L7 load-balancers, distributed caching, and all surrounding systems -- and is highly desirable. Our experience suggests that many network-oriented systems and services (e.g., route leak mitigation, denial of service, measurement) could be improved, and new ones designed, if built with addressing agility.
