---
title: "RFC 9149: TLS Ticket Requests"
year: 2022
location: Internet Engineering Task Force (IETF). 2022.
authors:
  - Tommy Pauly
  - David Schinazi
  - christopher-wood
url: https://datatracker.ietf.org/doc/rfc9149/
related_areas:
  - security
  - protocols
---

TLS session tickets enable stateless connection resumption for clients without server-side, per-client state.  Servers vend an arbitrary number of session tickets to clients, at their discretion, upon connection establishment.  Clients store and use tickets when resuming future connections.  This document describes a mechanism by which clients can specify the desired number of tickets needed for future connections.  This extension aims to provide a means for servers to determine the number of tickets to generate in order to reduce ticket waste while simultaneously priming clients for future connection attempts.