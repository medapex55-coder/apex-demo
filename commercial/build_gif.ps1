Add-Type -AssemblyName System.Drawing

$proj = "C:\Users\good-\OneDrive\Desktop\Claude\Apex Project\commercial"
$framesDir = Join-Path $proj "frames"
$rawGif = Join-Path $proj "_raw_multiframe.gif"
$outGif = Join-Path $proj "APEX_Presentation.gif"

# --- Step 1: read delays (ms) ---
$delayLines = Get-Content (Join-Path $framesDir "delays.txt")
$delaysMs = $delayLines | ForEach-Object { [int]$_ }

# --- Step 2: build multi-frame GIF via GDI+ SaveAdd ---
$files = Get-ChildItem -Path $framesDir -Filter "frame_*.png" | Sort-Object Name
if ($files.Count -eq 0) { throw "No frames found in $framesDir" }
Write-Host "Frames found: $($files.Count)"

$gifCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/gif' }

$firstBmp = New-Object System.Drawing.Bitmap($files[0].FullName)
$epStart = New-Object System.Drawing.Imaging.EncoderParameters(1)
$epStart.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::SaveFlag, [long][System.Drawing.Imaging.EncoderValue]::MultiFrame)
$firstBmp.Save($rawGif, $gifCodec, $epStart)

for ($i = 1; $i -lt $files.Count; $i++) {
  $bmp = New-Object System.Drawing.Bitmap($files[$i].FullName)
  $epAdd = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $epAdd.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::SaveFlag, [long][System.Drawing.Imaging.EncoderValue]::FrameDimensionTime)
  $firstBmp.SaveAdd($bmp, $epAdd)
  $bmp.Dispose()
}

$epFlush = New-Object System.Drawing.Imaging.EncoderParameters(1)
$epFlush.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::SaveFlag, [long][System.Drawing.Imaging.EncoderValue]::Flush)
$firstBmp.SaveAdd($epFlush)
$firstBmp.Dispose()

Write-Host "Raw multi-frame GIF written: $rawGif ($((Get-Item $rawGif).Length) bytes)"

# --- Step 3: parse the raw GIF and re-inject Graphic Control Extensions + Netscape loop ---
$bytes = [System.IO.File]::ReadAllBytes($rawGif)
$pos = 6  # skip "GIF89a"
# Logical Screen Descriptor: 7 bytes
$packed = $bytes[$pos + 4]
$hasGCT = ($packed -band 0x80) -ne 0
$gctSize = 0
if ($hasGCT) { $gctSize = 3 * [math]::Pow(2, ($packed -band 0x07) + 1) }
$pos += 7
if ($hasGCT) { $pos += $gctSize }
$headerEnd = $pos   # everything before this = header+LSD+GCT, copied as-is

# Walk blocks, recording segments
$segments = New-Object System.Collections.Generic.List[Object]  # each: @{Type='ext'/'img'; Start=int; End=int(exclusive)}
$n = $bytes.Length
while ($pos -lt $n) {
  $b = $bytes[$pos]
  if ($b -eq 0x21) {
    $segStart = $pos
    $pos += 2  # introducer + label
    while ($true) {
      $blockSize = $bytes[$pos]
      $pos += 1
      if ($blockSize -eq 0) { break }
      $pos += $blockSize
    }
    $segments.Add(@{ Type = 'ext'; Start = $segStart; End = $pos })
  }
  elseif ($b -eq 0x2C) {
    $segStart = $pos
    $pos += 1
    $pos += 8  # left,top,width,height (2 bytes each)
    $imgPacked = $bytes[$pos]
    $pos += 1
    if (($imgPacked -band 0x80) -ne 0) {
      $lctSize = 3 * [math]::Pow(2, ($imgPacked -band 0x07) + 1)
      $pos += [int]$lctSize
    }
    $pos += 1  # LZW minimum code size
    while ($true) {
      $blockSize = $bytes[$pos]
      $pos += 1
      if ($blockSize -eq 0) { break }
      $pos += $blockSize
    }
    $segments.Add(@{ Type = 'img'; Start = $segStart; End = $pos })
  }
  elseif ($b -eq 0x3B) {
    break
  }
  else {
    # Unexpected byte; abort parse loop to avoid corrupting output
    break
  }
}

Write-Host "Segments parsed: $($segments.Count) (expected $($files.Count) image segments)"
$imgCount = ($segments | Where-Object { $_.Type -eq 'img' }).Count
Write-Host "Image segments: $imgCount"

# --- Step 4: reconstruct the GIF with GCE + NETSCAPE loop extension ---
$out = New-Object System.Collections.Generic.List[byte]

# header + LSD + GCT
for ($i = 0; $i -lt $headerEnd; $i++) { $out.Add($bytes[$i]) }

# NETSCAPE2.0 application extension (infinite loop)
$netscape = [byte[]](0x21,0xFF,0x0B) + [System.Text.Encoding]::ASCII.GetBytes("NETSCAPE2.0") + [byte[]](0x03,0x01,0x00,0x00,0x00)
foreach ($bb in $netscape) { $out.Add($bb) }

$imgIndex = 0
foreach ($seg in $segments) {
  if ($seg.Type -eq 'img') {
    $delayMs = $delaysMs[$imgIndex]
    if ($imgIndex -ge $delaysMs.Count) { $delayMs = 2000 }
    $cs = [int][math]::Round($delayMs / 10.0)
    if ($cs -lt 5) { $cs = 5 }
    $lo = $cs -band 0xFF
    $hi = ($cs -shr 8) -band 0xFF
    $gce = [byte[]](0x21,0xF9,0x04,0x08,$lo,$hi,0x00,0x00)  # disposal=2 (restore to bg), no transparency
    foreach ($bb in $gce) { $out.Add($bb) }
    $imgIndex++
  }
  for ($i = $seg.Start; $i -lt $seg.End; $i++) { $out.Add($bytes[$i]) }
}

$out.Add(0x3B)  # trailer

[System.IO.File]::WriteAllBytes($outGif, $out.ToArray())
Write-Host "Final animated GIF written: $outGif ($((Get-Item $outGif).Length) bytes)"
Write-Host "Frames encoded with delays: $imgIndex"
