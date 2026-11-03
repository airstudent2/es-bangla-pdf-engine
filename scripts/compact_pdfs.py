import os
import sys
import re
import zlib

def compact_single_pdf(in_path, out_path):
    with open(in_path, 'rb') as f:
        data = f.read()

    obj_pattern = re.compile(rb'(\d+)\s+(\d+)\s+obj\r?\n(.*?)\r?\nendobj', re.DOTALL)
    objects = {}
    for m in obj_pattern.finditer(data):
        obj_id = int(m.group(1))
        objects[obj_id] = m.group(3)

    trailer_m = re.search(rb'trailer\s*<<(.*?)>>\s*startxref', data, re.DOTALL)
    if not trailer_m:
        raise ValueError('No trailer found')
    trailer_dict = trailer_m.group(1)
    root_m = re.search(rb'/Root\s+(\d+)\s+(\d+)\s+R', trailer_dict)
    if not root_m:
        raise ValueError('No Root in trailer')
    root_id = int(root_m.group(1))

    # Strip StructTreeRoot and MarkInfo from Catalog
    root_body = objects[root_id]
    root_body = re.sub(rb'/StructTreeRoot\s+\d+\s+\d+\s+R', rb'', root_body)
    root_body = re.sub(rb'/MarkInfo\s*<<.*?>>', rb'', root_body, flags=re.DOTALL)
    objects[root_id] = root_body

    ref_pattern = re.compile(rb'(\d+)\s+0\s+R')
    reachable = set()
    queue = [root_id]
    stream_objs = set()

    while queue:
        curr = queue.pop(0)
        if curr in reachable or curr not in objects:
            continue
        reachable.add(curr)
        body = objects[curr]
        if b'/Type /Page' in body or b'/Type/Page' in body:
            body = re.sub(rb'/StructParents\s+\d+', rb'', body)
            objects[curr] = body

        if b'stream' in body:
            stream_objs.add(curr)

        for ref_m in ref_pattern.finditer(body):
            ref_id = int(ref_m.group(1))
            if ref_id not in reachable and ref_id in objects:
                queue.append(ref_id)

    # Process all reachable streams (strip BDC/EMC and reduce excess float precision)
    for sid in stream_objs:
        body = objects[sid]
        m = re.search(rb'^(<<.*?>>\s*stream\r?\n)(.*?)(\r?\nendstream)$', body, re.DOTALL)
        if m:
            hdr = m.group(1)
            raw = m.group(2)
            ftr = m.group(3)
            # Only process if NOT a font binary file
            if b'/Length1' not in hdr:
                try:
                    decomp = zlib.decompress(raw)
                    # 1. Strip orphaned BDC and EMC markers
                    decomp = re.sub(rb'/[A-Za-z0-9]+\s*<<.*?>>\s*BDC\s*', rb'', decomp)
                    decomp = re.sub(rb'\s*EMC\s*', rb' ', decomp)
                    # 2. Reduce excessive float decimals beyond 2 places (0.01 pt = 0.0035 mm)
                    decomp = re.sub(rb'(\b-?\d+\.\d{2})\d{2,}\b', rb'\1', decomp)
                    recomp = zlib.compress(decomp, level=9)
                    hdr = re.sub(rb'/Length\s+\d+', f'/Length {len(recomp)}'.encode('ascii'), hdr)
                    objects[sid] = hdr + recomp + ftr
                except:
                    pass

    reachable_sorted = sorted(reachable)
    id_map = {old_id: (new_id + 1) for new_id, old_id in enumerate(reachable_sorted)}

    def remap_refs(body_bytes):
        def replace_ref(m):
            old = int(m.group(1))
            if old in id_map:
                return f'{id_map[old]} 0 R'.encode('ascii')
            return m.group(0)
        return ref_pattern.sub(replace_ref, body_bytes)

    out_parts = [b'%PDF-1.4\n%\xd3\xeb\xe9\xe1\n']
    xref_offsets = [0]

    for old_id in reachable_sorted:
        new_id = id_map[old_id]
        body = remap_refs(objects[old_id])
        offset = sum(len(p) for p in out_parts)
        xref_offsets.append(offset)
        out_parts.append(f'{new_id} 0 obj\n'.encode('ascii'))
        out_parts.append(body)
        out_parts.append(b'\nendobj\n')

    xref_start = sum(len(p) for p in out_parts)
    num_objs = len(xref_offsets)

    xref_table = [f'xref\n0 {num_objs}\n0000000000 65535 f \n'.encode('ascii')]
    for off in xref_offsets[1:]:
        xref_table.append(f'{off:010d} 00000 n \n'.encode('ascii'))

    out_parts.extend(xref_table)

    new_root_id = id_map[root_id]
    trailer = f'''trailer
<<
/Size {num_objs}
/Root {new_root_id} 0 R
>>
startxref
{xref_start}
%%EOF
'''.encode('ascii')
    out_parts.append(trailer)

    compacted = b''.join(out_parts)
    with open(out_path, 'wb') as f:
        f.write(compacted)
    return len(data), len(compacted)

def main():
    if len(sys.argv) < 2:
        target_dir = os.path.join(os.path.dirname(__file__), '..', 'output_pdfs')
    else:
        target_dir = sys.argv[1]

    if not os.path.exists(target_dir):
        print(f"Directory not found: {target_dir}")
        return

    pdf_files = [f for f in os.listdir(target_dir) if f.endswith('.pdf')]
    print(f"Compacting {len(pdf_files)} PDFs in {target_dir}...")

    total_orig = 0
    total_comp = 0
    success = 0

    for f in pdf_files:
        p = os.path.join(target_dir, f)
        temp_out = p + '.tmp'
        try:
            orig, comp = compact_single_pdf(p, temp_out)
            os.replace(temp_out, p)
            total_orig += orig
            total_comp += comp
            success += 1
        except Exception as e:
            if os.path.exists(temp_out):
                os.remove(temp_out)
            print(f"Error compacting {f}: {e}")

    if total_orig > 0:
        savings = ((total_orig - total_comp) / total_orig) * 100
        print(f"Successfully compacted {success}/{len(pdf_files)} files!")
        print(f"Original: {total_orig / (1024*1024):.2f} MB -> Compacted: {total_comp / (1024*1024):.2f} MB ({savings:.1f}% reduction)")

if __name__ == '__main__':
    main()
