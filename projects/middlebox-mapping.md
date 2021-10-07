---
title: Middlebox Mapping
related_profiles:
  - nick-sullivan
  - luke-valenta
related_publications:
  - Durumeric2017
related_areas:
  - distributed_systems
  - measurement
resources:
  - text: "Monsters in the Middleboxes: Introducing Two New Tools for Detecting HTTPS Interception"
    blog: https://blog.cloudflare.com/monsters-in-the-middleboxes/
  - text: GitHub Organization
    link: https://github.com/cloudflare/mitmengine
  - text: Measuring Active Listeners, Connection Observers, and Legitimate Monitors
    link: https://malcolm.cloudflare.com/
  - text: "Monsters in the Middleboxes: Building Tools for Detecting HTTPS Interception"
    youtube: https://www.youtube.com/embed/EpGewXz7tLw
---

This project addresses HTTPS interception and middleboxes, which can often degrade the security of Internet connections.

We have made available two tools:
- MITMEngine: an open-source library for HTTPS interception detection, and
- MALCOLM: a dashboard displaying metrics about HTTPS interception we observe on Cloudflare’s network.