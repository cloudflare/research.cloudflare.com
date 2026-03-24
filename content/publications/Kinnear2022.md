---
title: "RFC 9230: Oblivious DNS over HTTPS"
year: 2022
location: Internet Engineering Task Force (IETF). 2022.
authors:
  - eric-kinnear
  - patrick-mcmanus
  - tommy-pauly
  - tanya-verma
  - christopher-wood
url: https://datatracker.ietf.org/doc/rfc9230/
related_interests:
  - security
  - privacy
  - protocols
pillar: private
metaDescription: "IETF protocol allowing clients to hide IP addresses from DNS resolvers by proxying encrypted DoH messages, preventing any single server from knowing both client IP and DNS query content."
---

This document describes a protocol that allows clients to hide their IP addresses from DNS resolvers via proxying encrypted DNS over HTTPS (DoH) messages. This improves privacy of DNS operations by not allowing any one server entity to be aware of both the client IP address and the content of DNS queries and answers.
