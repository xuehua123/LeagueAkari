# Bundled FFmpeg runtime

League Akari packages the Windows x64 **LGPL shared** FFmpeg build declared in
`manifest.json`. The build step downloads the pinned archive, verifies its SHA-256, and copies only
the runtime binaries plus the upstream `LICENSE.txt` into `runtime/`.

The runtime is dynamically linked and kept as separate files so recipients can replace the LGPL
libraries. Corresponding FFmpeg source and the exact build scripts are linked by `sourceOfferUrl`
and `buildSourceUrl` in the manifest.

Run `yarn prepare:ffmpeg:win` before local video-import testing. Packaged Windows builds run this
step automatically and never depend on a machine-wide `PATH` installation.
