---
title: "Respect the ORIGIN! A Best-case Evaluation of Connection Coalescing"
year: 2022
location: ACM Internet Measurement Conference 2022, October 25-27, France. 2022.
authors:
  - sudheesh-singanamalla
  - talha-paracha
  - suleman-ahmad
  - jonathan-hoyland
  - luke-valenta
  - Yevgen Safronov
  - peter-wu
  - Andrew Galloni
  - Kurtis Heimerl
  - nick-sullivan
  - christopher-wood
  - marwan-fayed
doi: 10.1145/3517745.3561453
artifacts:
  - text: "Experimental data"
    url: https://github.com/cloudflare/connection-coalescing-imc22
  - text: "Go code: net-originframe"
    url: https://github.com/cloudflare/net-originframe
  - text: "Go code: go-originframe"
    url: https://github.com/cloudflare/go-originframe
related_interests:
  - privacy
  - measurement
---

Connection coalescing, enabled by HTTP/2, permits a client to use an existing connection to request additional resources at the connected hostname. The potential for requests to be coalesced is hindered by the practice of domain sharding introduced by HTTP/1.1, because subresources are scattered across subdomains in an effort to improve performance with additional connections. When this happens, HTTP/2 clients invoke additional DNS queries and new connections to retrieve content that is available at the same server. ORIGIN Frames is an HTTP/2 extension standardized by the IETF in 2018 that webservers can use to give explicit indications to the client about the domains that are reachable on the connection. However, no server implementation of ORIGIN Frames exists and only one browser supports them. In this paper, we collect and characterize a large dataset. We use that dataset to model connection coalescing and identify a least-effort set of certificate changes that maximize opportunities for clients to coalesce. We work with a large partner CDN to reissue certificates, build and deploy ORIGIN frame support globally at scale, evaluate and validate our modelling with both passive and active measurement of 5000 domains.
