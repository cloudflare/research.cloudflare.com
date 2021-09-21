---
title: The Security Impact of HTTPS Interception
year: 2017
location: Network and Distributed System Security Symposium (NDSS) 2017.
authors:
  - Zakir Durumeric
  - Zane Ma
  - Drew Springall
  - Richard Barnes
  - nick-sullivan
  - Elie Bursztein
  - Michael Bailey
  - J. Alex Halderman
  - Vern Paxson
url: https://www.ndss-symposium.org/wp-content/uploads/2017/09/ndss2017_04A-4_Durumeric_paper_0.pdf
related_areas:
  - security
  - measurement
---

As HTTPS deployment grows, middlebox and antivirus products are increasingly intercepting TLS connections to retain visibility into network traffic. In this work, we present a comprehensive study on the prevalence and impact of HTTPS interception. First, we show that web servers can detect interception by identifying a mismatch between the HTTP User-Agent header and TLS client behavior. We characterize the TLS handshakes of major browsers and popular interception products, which we use to build a set of heuristics to detect interception and identify the responsible product. We deploy these heuristics at three large network providers: (1) Mozilla Firefox update servers, (2) a set of popular e-commerce sites, and (3) the Cloudflare content distribution network. We find more than an order of magnitude more interception than previously estimated and with dramatic impact on connection security. To understand why security suffers, we investigate popular middleboxes and clientside security software, finding that nearly all reduce connection security and many introduce severe vulnerabilities. Drawing on our measurements, we conclude with a discussion on recent proposals to safely monitor HTTPS and recommendations for the security community.
