---
title: Oblivious DNS over HTTPS
related_profiles:
  - nick-sullivan
  - tanya-verma
  - peter-wu
  - christopher-wood
  - marwan-fayed
related_publications:
  - Singanamalla2021
  - Kinnear2022
related_areas:
  - security
  - privacy
resources:
  - text: "Improving DNS Privacy with Oblivious DoH in 1.1.1.1"
    blog: https://blog.cloudflare.com/oblivious-dns/
  - text: GitHub Organization
    link: https://github.com/cloudflare?q=odoh
  - text: Tamarin Model of Oblivious DNS over HTTP
    link: https://github.com/cloudflare/odoh-analysis
  - text: Oblivious DoH Deep Dive 
    cfstream: 651f1568f1611fad7fccf7e90c9f46b8
---

<img src="https://blog.cloudflare.com/content/images/2020/12/image2-4.png" alt="Oblivious DNS over HTTPS" width="300" align="right" />


Oblivious DNS over HTTPS (ODoH) is an [emerging protocol](https://tools.ietf.org/html/draft-pauly-dprive-oblivious-doh-03) being developed at the IETF and co-authored by engineers from Cloudflare, Apple, and Fastly. ODoH is supported by leading proxy partners, including PCCW Global, SURF, and Equinix.

The ODoH protocol is a practical approach for improving privacy of users and aims to improve the overall adoption of encrypted DNS protocols without compromising performance and user experience on the Internet. ODoH works by adding a layer of public key encryption, as well as a network proxy between clients and DNS over HTTPS servers such as 1.1.1.1. The combination of these two added elements guarantees that only the user, and not any other single entity, has access to both the DNS messages and their own IP address at the same time.

We’ve made source code available, so anyone can try out ODoH or run their own ODoH service.

