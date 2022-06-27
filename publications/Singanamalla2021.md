---
title: "Oblivious DNS over HTTPS (ODoH): A Practical Privacy Enhancement to DNS"
year: 2021
location: Proceedings on Privacy Enhancing Technologies 2021, Volume 4, pp. 575–592. 2021.
authors:
  - sudheesh-singanamalla
  - Pop Chunhapanya
  - jonathan-hoyland
  - Marek Vavruša
  - tanya-verma
  - peter-wu
  - marwan-fayed
  - Kurtis Heimerl
  - nick-sullivan
  - christopher-wood
url: https://www.petsymposium.org/2021/files/papers/issue4/popets-2021-0085.pdf
doi: 10.2478/popets-2021-0085
related_interests:
  - privacy
  - measurement
---

The Internet’s Domain Name System (DNS) responds to client hostname queries with corresponding IP addresses and records. Traditional DNS is unencrypted and leaks user information to on-lookers. Recent efforts to secure DNS using DNS over TLS (DoT) and DNS over HTTPS (DoH) have been gaining traction, ostensibly protecting DNS messages from third parties. However, the small number of available public largescale DoT and DoH resolvers has reinforced DNS privacy concerns, specifically that DNS operators could use query contents and client IP addresses to link activities with identities. Oblivious DNS over HTTPS (ODoH) safeguards against these problems. In this paper we implement and deploy interoperable instantiations of the protocol, construct a corresponding formal model and analysis, and evaluate the protocols’ performance with wide-scale measurements. Results suggest that ODoH is a practical privacy-enhancing replacement for DNS.
