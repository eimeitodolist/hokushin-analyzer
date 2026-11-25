"""LPのURLからQRコード（印刷用PNG・SVG）を作る。
使い方: python3 make_qr.py https://公開先のURL
必要: pip install "qrcode[pil]"
"""
import sys
from pathlib import Path
import qrcode
import qrcode.image.svg

url = sys.argv[1] if len(sys.argv) > 1 else ""
if not url.startswith("https://"):
    sys.exit("https:// で始まる公開URLを指定してください")

out = Path(__file__).parent / "qr"
out.mkdir(exist_ok=True)
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=20, border=4)
qr.add_data(url)
qr.make(fit=True)
qr.make_image(fill_color="black", back_color="white").save(out / "jigaku-jishin-lp-qr.png")
qr.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(out / "jigaku-jishin-lp-qr.svg")
print("作成しました:", out / "jigaku-jishin-lp-qr.png", "/", out / "jigaku-jishin-lp-qr.svg")
