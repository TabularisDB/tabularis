#!/bin/sh
# Test plugin that never answers and keeps running after its stdin closes,
# like a plugin stuck on a request. The host has to stop it by itself (#1280).
exec sleep 600
