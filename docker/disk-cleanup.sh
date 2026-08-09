#!/bin/sh
# Weekly host disk cleanup: docker build cache/dangling images, apt cache, old journals.
# All reclaimed data is regenerable (build cache, package downloads, log history).
docker builder prune -af
docker image prune -af
apt-get clean
journalctl --vacuum-time=7d
