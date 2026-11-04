import os
import glob
from PIL import Image

raw_dir = 'raw_thumbnails'
out_dir = 'output_thumbnails'
os.makedirs(out_dir, exist_ok=True)

files = sorted(glob.glob(os.path.join(raw_dir, 'pyq_*.png')))
total_orig = 0
total_new = 0

print(f"Found {len(files)} thumbnails to optimize...")

for f in files:
    fname = os.path.basename(f)
    orig_sz = os.path.getsize(f)
    total_orig += orig_sz
    
    with Image.open(f) as img:
        # Resize to 640x360 (crisp retina for 130x74 display size)
        img_rgb = img.convert('RGB')
        resized = img_rgb.resize((640, 360), Image.Resampling.LANCZOS)
        
        # Adaptive palette 256 colors PNG
        quantized = resized.convert('P', palette=Image.Palette.ADAPTIVE, colors=256)
        
        out_path = os.path.join(out_dir, fname)
        quantized.save(out_path, format='PNG', optimize=True)
        
        new_sz = os.path.getsize(out_path)
        total_new += new_sz
        pct = 100 - (new_sz * 100 // orig_sz)
        print(f"  {fname}: {orig_sz // 1024} KB -> {new_sz // 1024} KB (-{pct}%)")

print("\nOptimization complete:")
print(f"Total Original: {total_orig / (1024 * 1024):.2f} MB")
print(f"Total Optimized: {total_new / (1024 * 1024):.2f} MB ({total_new / 1024:.1f} KB)")
