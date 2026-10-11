Add-Type -AssemblyName System.Drawing

$src = "D:\selfimpulse\public\brand\si-wordmark.jpg"
$dst = "D:\selfimpulse\public\brand\si-wordmark.png"

# The supplied wordmark is cream lettering on a flat BLACK field. That is already
# almost right for a dark rail, but JPEG has baked a mottled black-noise floor
# into the background, and on any surface that is not pure black that noise shows
# as a dirty rectangle.
#
# Luminance is therefore used as the matte: the cream glyphs are bright and stay
# opaque, the black field drops to fully transparent, and the short ramp between
# them is kept as the anti-aliased edge so the letters stay smooth rather than
# looking cut out. The FLOOR kills the JPEG's background noise outright.
$img = [System.Drawing.Image]::FromFile($src)
$w = $img.Width
$h = $img.Height

$out = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$CREAM_R = 237; $CREAM_G = 233; $CREAM_B = 223
$FLOOR = 14.0
$SPAN = 255.0 / (255.0 - $FLOOR)

$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $out.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$buf = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)

$hist = @{}
for ($y = 0; $y -lt $h; $y++) {
  $row = $y * $stride
  for ($x = 0; $x -lt $w; $x++) {
    $c = $img.GetPixel($x, $y)
    $l = (0.299 * $c.R) + (0.587 * $c.G) + (0.114 * $c.B)
    if ($l -le $FLOOR) { $a = 0 }
    else {
      $a = [int](($l - $FLOOR) * $SPAN)
      if ($a -gt 255) { $a = 255 }
      if ($a -lt 0) { $a = 0 }
    }
    $o = $row + ($x * 4)
    $buf[$o]     = $CREAM_B
    $buf[$o + 1] = $CREAM_G
    $buf[$o + 2] = $CREAM_R
    $buf[$o + 3] = $a
    $k = [int]($a / 64) * 64
    if ($hist.ContainsKey($k)) { $hist[$k]++ } else { $hist[$k] = 1 }
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($buf, 0, $data.Scan0, $buf.Length)
$out.UnlockBits($data)

if (Test-Path $dst) { Remove-Item $dst -Force }
$out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
$out.Dispose()

$fi = Get-Item $dst
"wrote {0}  {1:N0} bytes  ({2}x{3})" -f $fi.FullName, $fi.Length, $w, $h
"alpha histogram:"
$hist.GetEnumerator() | Sort-Object Name | ForEach-Object { "  alpha {0,3}-{1,-3}: {2}" -f $_.Name, ($_.Name + 63), $_.Value }