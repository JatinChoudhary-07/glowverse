#!/usr/bin/env node
// Generates resources/tray.png: a small luminous rounded-square rim for the tray.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 64
const HALF = 0.74
const RADIUS = 0.26

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

function sdRoundedBox(px, py, half, radius) {
  const qx = Math.abs(px) - (half - radius)
  const qy = Math.abs(py) - (half - radius)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const px = ((x + 0.5) / SIZE) * 2 - 1
    const py = ((y + 0.5) / SIZE) * 2 - 1
    const distance = sdRoundedBox(px, py, HALF, RADIUS)
    const core = smoothstep(0.07, 0.015, Math.abs(distance))
    const glow = Math.exp(-Math.max(Math.abs(distance) - 0.02, 0) * 6)
    const alpha = Math.min(1, core * 0.95 + glow * 0.5)
    const mix = (px + 1) / 2
    const offset = (y * SIZE + x) * 4
    pixels[offset] = Math.round(255 + (111 - 255) * mix)
    pixels[offset + 1] = Math.round(95 + (139 - 95) * mix)
    pixels[offset + 2] = Math.round(162 + (255 - 162) * mix)
    pixels[offset + 3] = Math.round(alpha * 255)
  }
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8
header[9] = 6
header[10] = 0
header[11] = 0
header[12] = 0

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const target = path.join(__dirname, '..', 'resources', 'tray.png')
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, png)
console.log(`wrote ${target} (${png.length} bytes)`)
