import struct, zlib, os
os.makedirs('media', exist_ok=True)
w, h = 128, 128
# Blue background (41, 98, 255)
row = b'\x00' + bytes([41, 98, 255] * w)
raw = row * h
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
with open('media/icon.png', 'wb') as f:
    f.write(b'\x89PNG\r\n\x1a\n')
    f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)))
    f.write(chunk(b'IDAT', zlib.compress(raw)))
    f.write(chunk(b'IEND', b''))
print(f'Icon created: {os.path.getsize("media/icon.png")} bytes')
