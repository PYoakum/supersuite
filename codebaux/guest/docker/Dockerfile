FROM i386/alpine:3.18.6

# ─── Build arguments ───
ENV KERNEL=lts
ENV HOSTNAME=codebaux
ENV ROOT_PASSWORD=root

# ─── Base system ───
RUN apk add openrc alpine-base agetty alpine-conf

# ─── 9p-compatible mkinitfs from edge ───
# Alpine 3.18's mkinitfs lacks 9p support; the edge version includes it.
# See: https://github.com/copy/v86/discussions/989
# Must also upgrade libcrypto3/libssl3 to edge so that nlplug-findfs
# (bundled in the initramfs by mkinitfs) finds matching OpenSSL symbols.
# Without this, boot fails with "OSSL_get_max_threads: symbol not found".
RUN apk add mkinitfs --no-cache --allow-untrusted \
    --repository https://dl-cdn.alpinelinux.org/alpine/edge/main/ \
 && apk add --upgrade libcrypto3 libssl3 --no-cache \
    --repository https://dl-cdn.alpinelinux.org/alpine/edge/main/

# ─── Kernel (32-bit LTS, required by v86) ───
RUN apk add linux-lts linux-firmware-none

# ─── Node.js runtime (npm not needed at runtime) ───
RUN apk add nodejs

# ─── Utilities for helper scripts ───
RUN apk add bash coreutils tar gzip

# ─── Root password and hostname ───
RUN echo "root:${ROOT_PASSWORD}" | chpasswd
RUN setup-hostname ${HOSTNAME}

# ─── Console: auto-login on tty1 ───
RUN sed -i 's/getty 38400 tty1/agetty --autologin root tty1 linux/' /etc/inittab

# ─── Console: serial port ttyS0 for v86 host↔guest bridge ───
RUN echo 'ttyS0::respawn:/sbin/agetty --autologin root -s ttyS0 115200 vt100' >> /etc/inittab

# ─── Enable 9p in initramfs ───
# v86 only needs base, virtio, and 9p — skip hardware drivers to shrink initramfs
RUN echo 'features="base virtio 9p"' \
    > /etc/mkinitfs/mkinitfs.conf
RUN mkinitfs $(ls /lib/modules/)

# ─── Suppress login noise ───
RUN echo "" > /etc/motd

# ─── Trim image size ───
RUN rm -rf /var/cache/apk/* \
    /usr/share/man/* \
    /usr/share/doc/* \
    /usr/share/info/* \
    /tmp/* \
    /var/tmp/*

# ─── Mark boot complete ───
# This label is used by the build pipeline for traceability
LABEL org.codebaux.role="guest-image" \
      org.codebaux.kernel="${KERNEL}"
