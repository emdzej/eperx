#!/usr/bin/env python3
"""F3 (KTD) header prober — checks the layout against a real file.

Not shipped; `packages/ktd` is the implementation. This exists so the header
reading can be validated against every F3 file on the disc before any
TypeScript is written, and so the two can be diffed later.

The layout is documented in openPER (MIT, Christopher Reynolds); this reads
the same fields out of the bytes to confirm them.
"""
import struct, sys, bz2

def fields(buf, at, n):
    out = []
    for _ in range(n):
        raw = buf[at:at+20]
        name = raw.split(b"\0")[0].decode("ascii", "replace")
        dtype, start, length = buf[at+20], buf[at+21], buf[at+22]
        out.append({"name": name, "type": dtype, "start": start, "len": length})
        at += 23
    return out, at

def header(buf):
    assert buf[:2] == b"F3", buf[:2]
    h = {"magic": "F3",
         "records": struct.unpack_from("<I", buf, 2)[0],
         "perBlock": struct.unpack_from("<H", buf, 6)[0],
         "refTables": list(struct.unpack_from("<5I", buf, 8)),
         "primaryIndex": struct.unpack_from("<I", buf, 28)[0],
         "secondaryIndexes": list(struct.unpack_from("<3I", buf, 32)),
         "table": buf[44:64].split(b"\0")[0].decode("ascii", "replace")}
    at = 64
    n = buf[at]; at += 1
    h["primaryKey"], at = fields(buf, at, n)
    h["secondary"] = []
    n = buf[at]; at += 1
    for _ in range(n):
        m = buf[at]; at += 1
        parts, at = fields(buf, at, m)
        h["secondary"].append(parts)
    n = buf[at]; at += 1
    h["columns"], at = fields(buf, at, n)
    h["headerEnd"] = at
    return h

if __name__ == "__main__":
    for path in sys.argv[1:]:
        buf = open(path, "rb").read(8192)
        h = header(buf)
        packed = sum(2 if c["type"] == 0 else c["len"] for c in h["columns"])
        unpacked = max(c["start"] + c["len"] for c in h["columns"])
        print(f"===== {path.split('/')[-1]}")
        print(f"  table={h['table']!r}  records={h['records']:,}  perBlock={h['perBlock']}")
        print(f"  primaryIndex@{h['primaryIndex']:,}  refTables={[t for t in h['refTables'] if t]}")
        print(f"  secondaryIndexes={[t for t in h['secondaryIndexes'] if t]}")
        print(f"  primary key: {'+'.join(f'{p['name']}({p['len']})' for p in h['primaryKey'])}"
              f"  = {sum(p['len'] for p in h['primaryKey'])} bytes")
        for i, parts in enumerate(h["secondary"]):
            print(f"  secondary {i}: {'+'.join(p['name'] for p in parts)}")
        print(f"  {len(h['columns'])} columns, packed={packed} unpacked>={unpacked} "
              f"→ length prefix would be {1 if packed < 256 else 2} byte(s)")
        for c in h["columns"]:
            kind = "ref" if c["type"] == 0 else "str"
            print(f"      {c['name']:<12} {kind} start={c['start']:<4} len={c['len']}")


def read_index(f, h):
    """Primary index: count, then (key, blockStart, blockEnd) per block."""
    keylen = sum(p["len"] for p in h["primaryKey"])
    f.seek(h["primaryIndex"])
    (count,) = struct.unpack("<I", f.read(4))
    out = []
    raw = f.read(count * (keylen + 8))
    for i in range(count):
        at = i * (keylen + 8)
        key = raw[at:at+keylen].decode("ascii", "replace")
        start, end = struct.unpack_from("<II", raw, at + keylen)
        out.append((key, start, end))
    return out


def read_ref_tables(f, h):
    tables = []
    for pos in h["refTables"]:
        if not pos:
            break
        f.seek(pos)
        count, width = struct.unpack("<II", f.read(8))
        raw = f.read(count * width)
        tables.append([raw[i*width:(i+1)*width] for i in range(count)])
    return tables


def unpack(record, h, tables):
    """Packed record -> the fixed-layout unpacked record."""
    extra = sum(c["len"] - 2 for c in h["columns"] if c["type"] == 0)
    out = bytearray(len(record) + extra)
    at = 0
    refs = 0
    for c in h["columns"]:
        if c["type"] == 0:
            (idx,) = struct.unpack_from("<H", record, at)
            out[c["start"]:c["start"]+c["len"]] = tables[refs][idx][:c["len"]]
            refs += 1
            at += 2
        else:
            n = c["len"] or (len(out) - c["start"])
            out[c["start"]:c["start"]+n] = record[at:at+n]
            at += n
    return bytes(out)


def records(block, prefix):
    """Length-prefixed records inside a decompressed block."""
    at = 0
    out = []
    while at < len(block):
        total = block[at] if prefix == 1 else block[at] | (block[at+1] << 8)
        if total < prefix or at + total > len(block):
            raise ValueError(f"record at {at} claims {total} bytes")
        out.append(block[at+prefix:at+total])
        at += total
    return out


def detect_prefix(block):
    """Which prefix width makes the records tile the block exactly."""
    for prefix in (1, 2):
        try:
            found = records(block, prefix)
        except ValueError:
            continue
        if found and all(len(r) > 0 for r in found):
            return prefix, found
    raise ValueError("neither a 1- nor 2-byte length prefix tiles this block")


def dump(path, limit=4):
    f = open(path, "rb")
    h = header(f.read(8192))
    tables = read_ref_tables(f, h)
    index = read_index(f, h)
    print(f"===== {path.split('/')[-1]}: {len(index):,} blocks, "
          f"{len(tables)} reference table(s)"
          + (f" of {len(tables[0]):,} entries" if tables else ""))
    key, start, end = index[0]
    f.seek(start)
    block = bz2.decompress(f.read(end - start))
    prefix, found = detect_prefix(block)
    print(f"  block 0: key={key!r} {end-start:,} bytes → {len(block):,} unpacked, "
          f"{len(found):,} records, {prefix}-byte prefix")
    for record in found[:limit]:
        row = unpack(record, h, tables)
        parts = []
        for c in h["columns"]:
            n = c["len"] or (len(row) - c["start"])
            parts.append(f"{c['name']}={row[c['start']:c['start']+n].decode('ascii','replace').strip()!r}")
        print("    " + "  ".join(parts))
    f.close()
