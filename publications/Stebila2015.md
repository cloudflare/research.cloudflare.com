---
title: An analysis of TLS handshake proxying
year: 2015
location: 2015 IEEE Trustcom/BigDataSE/ISPA, volume 1, pp. 279-286. 2015.
authors: 
  - Douglas Stebila
  - nick-sullivan
url: https://ieeexplore.ieee.org/abstract/document/7345293/
related_areas:
  - cryptography
  - authentication
related_projects:
  - geokm
---

Content delivery networks (CDNs) are an essential component of modern website infrastructures: edge servers located closer to users cache content, increasing robustness and capacity while decreasing latency. However, this situation becomes complicated for HTTPS content that is to be delivered using the Transport Layer Security (TLS) protocol: the edge server must be able to carry out TLS handshakes for the cached domain. Most commercial CDNs require that the domain owner give their certificate's private key to the CDN's edge server or abandon caching of HTTPS content entirely. We examine the security and performance of a recently commercialized delegation technique in which the domain owner retains possession of their private key and splits the TLS state machine geographically with the edge server using a private key proxy service. This allows the domain owner to limit the amount of trust given to the edge server while maintaining the benefits of CDN caching. On the performance front, we find that latency is slightly worse compared to the insecure approach, but still significantly better than the domain owner serving the content directly. On the security front, we enumerate the security goals for TLS handshake proxying and identify a subtle difference between the security of RSA key transport and signed-Diffie-Hellman in TLS handshake proxying, we also discuss timing side channel resistance of the key server and the effect of TLS session resumption.
